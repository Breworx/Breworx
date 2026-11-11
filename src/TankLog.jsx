import { useState, useMemo, useEffect, useRef } from "react";
import { Plus, Droplet, X, TrendingUp, Beaker, Package, AlertTriangle, Truck, CheckCircle2, Trash2, LogOut, Settings, Users, Home, LayoutGrid, FileText, FlaskConical, Warehouse, Box, Layers, Info, Calendar, Search, Menu, QrCode, Sparkles } from "lucide-react";
import { supabase } from "./supabaseClient";
import { productKeyForBatch } from "./lib/brewPlanner";
import { rowToBatch, batchToRow, rowToInventoryItem, inventoryItemToRow, rowToPO, poToRow, rowToRecipe, recipeToRow, rowToProfile, rowToTank, tankToRow, rowToStockTake, stockTakeToRow, rowToFoodSafetyRecord, foodSafetyRecordToRow, rowToSupplier, supplierToRow, rowToCustomer, customerToRow, rowToCustomerPrice, customerPriceToRow, rowToYeastHarvest, yeastHarvestToRow, rowToMixedPackType, mixedPackTypeToRow, rowToMixedPackAssembly, mixedPackAssemblyToRow, rowToPestStation, pestStationToRow, rowToExciseItemCode, exciseItemCodeToRow, rowToExciseReturn, exciseReturnToRow, rowToAiFeedback, aiFeedbackToRow, rowToKeg, kegToRow, rowToTriangleTest, triangleTestToRow, rowToSalesOrder, salesOrderToRow, rowToSupplierDocument, supplierDocumentToRow, rowToConsumable, consumableToRow, rowToPackageType, packageTypeToRow, rowToReminder, reminderToRow, rowToActivity, activityToRow } from "./lib/mappers";
import { AuthScreen, DeleteAccountModal, DeleteCompanyModal, EmailConfirmedScreen } from "./components/account";
import { AuditSharesModal } from "./components/auditor";
import { BatchDetail } from "./components/batchDetail";
import { AddBatchModal, AddBrewDayModal, AddSplitTankIngredientModal, DiacetylTestModal, DiscardRemainingModal, EditBrewDayFieldModal, LogReadingModal, PackagingModal, StartPackagingModal, sisterTankBatches, splitPackagingRun } from "./components/batches";
import { BatchCard, InventoryItemCard } from "./components/cards";
import { CiderView } from "./components/cider";
import { CustomerAccountFlow, CustomerDetail, CustomerFormModal, CustomerPortalPage, CustomersView } from "./components/customers";
import { ExciseReportView, PackagedView } from "./components/excise";
import { AssembleMixedPackModal, ClearStockModal, FinishedGoodsStockView, MixedPackTypeModal } from "./components/finishedStock";
import { CalibrationModal, FoodSafetyChecklistModal, FoodSafetyDisclaimerModal, FoodSafetyNoteModal, FoodSafetyView, HarvestYeastModal, InternalAuditModal, LabMeasurementModal, LogComplaintModal, LogContractorVisitModal, LogPestCheckModal, LogVerifierVisitModal, MaintenanceModal, MockRecallModal, PestStationsModal, SensoryScoreModal, StaffIllnessModal, StaffTrainingRecordModal, SupplierDocumentsModal, SupplierFormModal, TastingLogModal, TopUpModal, TrainingModal } from "./components/foodSafety";
import { AiFeedbackReviewModal, AiHelperModal, CHANGELOG, HELP_ARTICLES, HelpGuideModal, LATEST_CHANGELOG_ID, PAGE_TOURS, SpotlightTour, TOUR_STEPS, TankQRModal, WhatsNewModal } from "./components/help";
import { AddInventoryModal, AddPackageTypeModal, AdjustInventoryModal, BulkOpeningStockModal, InventoryDuplicatesPanel, InventoryItemDetail, PackageTypeCard, PackageTypeDetail, StockTakeHistoryModal, StockTakeModal, StockTakeReportModal, SuppliersModal } from "./components/inventory";
import { BrewPlannerView } from "./components/planner";
import { AddPOModal, POCard, PODetail } from "./components/purchasing";
import { QcApprovalModal, QualityControlView, TriangleTestModal } from "./components/quality";
import { AddRecipeModal, MissingIngredientsModal, RecipeAnalyticsView, RecipeCard, RecipeDetail, ScaleRecipeModal } from "./components/recipes";
import { AddKegsModal, AddSalesOrderModal, KegDetail, KegsView, PrintableOrderModal, RecordFulfillmentModal, SalesAnalyticsView, SalesOrderDetail, SalesOrdersView } from "./components/sales";
import { AddTankModal, AssignTankModal, ConfirmDeleteBatchModal, ConfirmDeleteRecipeModal, ConfirmDeleteSupplierModal, ConfirmDeleteTankModal, EditSplitTanksModal, EditTankModal, TankHistoryModal, TransferToFermenterModal, VesselTransferModal } from "./components/tanks";
import { TraceabilityView, deductFromLotsFIFO, planXeroSalesHistory } from "./components/traceability";
import { APP_VERSION, BreworxMark, BrewpointErrorBoundary, BrewpointLoadingMark, ConfirmDialogModal, EmptyState, OfflineBanner, SkeletonList, ToastStack, UpdateBanner, stampForDate } from "./components/ui";
import { AgingOverviewView, EditScheduledBatchModal, HomeView, IngredientsNeededModal, ProductionManagerView, QuickJumpModal, ReminderDayModal, YeastView } from "./components/views";
import { ImportXeroContactsModal, SameBeerModal, XeroContactLinkModal, XeroHistoryImport, XeroItemMatchModal, XeroMappingModal, XeroProductMappingModal, XeroStockCompareModal, planXeroStockMatch } from "./components/xero";
import { CATEGORIES, CATEGORY_COLOR, CONSUMABLE_CATEGORIES, buildXeroAuthUrl, findMissingIngredients, latestReading } from "./lib/config";
import { levyForDeclaredLines, monthKeyFromDate, monthLabelFromKey } from "./lib/excise";
import { CANS_PER_CASE, CONTAINERS, FAULT_SEVERITY_NEXT, NEXT_CLEAN_STAGE, activeRecipesByFamily, applyLineMatch, availableStockList, canonicalBeerName, getStages, inventoryItemValue, mixedPackStockList, occupyingBatch, packagingDiscarded, packagingEvents, planXeroSales, productKeyFor, remainingVolume, sameItemName, sortedTanks, setBeerAliasMap, uid, unitFactor } from "./lib/production";
import { downloadCSV, downloadJSON, insertByDate, today, withStageDate } from "./lib/utils";


function TankLogApp() {
  const [session, setSession] = useState(undefined); // undefined = not checked yet, null = signed out
  const [justConfirmedEmail, setJustConfirmedEmail] = useState(() => {
    const hash = window.location.hash || "";
    return hash.includes("type=signup") || hash.includes("type=invite") || hash.includes("type=email_change");
  });
  const [loadingData, setLoadingData] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [isOffline, setIsOffline] = useState(typeof navigator !== "undefined" && !navigator.onLine);
  useEffect(() => {
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Detects when a newer build has been deployed while this session is still
  // open — important for the installed PWA, which otherwise keeps showing a
  // stale cached version until the user manually reinstalls it.
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersionSeen, setLatestVersionSeen] = useState(null);
  useEffect(() => {
    const checkForUpdate = async () => {
      try {
        const res = await fetch(`/version.txt?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const latest = (await res.text()).trim();
        setLatestVersionSeen(latest);
        if (latest && latest !== APP_VERSION) setUpdateAvailable(true);
      } catch {
        // Network hiccup or offline — not worth surfacing, just skip this check.
      }
    };
    checkForUpdate();
    const interval = setInterval(checkForUpdate, 5 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  const showToast = (type, message, action) => {
    const id = uid();
    setToasts((prev) => [...prev, { id, type, message, action }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), action ? 6000 : 4500);
    return id;
  };
  const dismissToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));
  const pendingDeletesRef = useRef({});
  const [view, setView] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("view") === "settings" ? "settings" : "home";
  });
  const [inviteToken] = useState(() => new URLSearchParams(window.location.search).get("invite"));
  const [tankParam] = useState(() => new URLSearchParams(window.location.search).get("tank"));
  const [qrTankTarget, setQrTankTarget] = useState(null);
  const [historyTankTarget, setHistoryTankTarget] = useState(null);

  useEffect(() => {
    if (window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  const [batches, setBatches] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [customerPrices, setCustomerPrices] = useState([]);
  const [yeastHarvests, setYeastHarvests] = useState([]);
  const [mixedPackTypes, setMixedPackTypes] = useState([]);
  const [mixedPackAssemblies, setMixedPackAssemblies] = useState([]);
  const [pestStations, setPestStations] = useState([]);
  const [exciseItemCodes, setExciseItemCodes] = useState([]);
  const [aiFeedback, setAiFeedback] = useState([]);
  const [kegs, setKegs] = useState([]);
  const [triangleTests, setTriangleTests] = useState([]);
  const [exciseReturns, setExciseReturns] = useState([]);
  const [showClearStock, setShowClearStock] = useState(false);
  const [editingTriangleTest, setEditingTriangleTest] = useState(null);
  const [showQcApproval, setShowQcApproval] = useState(false);
  const [showLabMeasurement, setShowLabMeasurement] = useState(false);
  const [editingMixedPackType, setEditingMixedPackType] = useState(null);
  const [showNewMixedPackType, setShowNewMixedPackType] = useState(false);
  const [assemblingMixedPackType, setAssemblingMixedPackType] = useState(null);
  const [activeReminderDay, setActiveReminderDay] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [logTarget, setLogTarget] = useState(null);
  const [brewDayFieldTarget, setBrewDayFieldTarget] = useState(null);
  const [packagingTarget, setPackagingTarget] = useState(null);
  const [discardTarget, setDiscardTarget] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [consumables, setConsumables] = useState([]);
  const [packageTypes, setPackageTypes] = useState([]);
  const [showAddInventory, setShowAddInventory] = useState(false);
  const [showBulkOpeningStock, setShowBulkOpeningStock] = useState(false);
  const [showBulkOpeningStockConsumables, setShowBulkOpeningStockConsumables] = useState(false);
  const [selectedInventoryId, setSelectedInventoryId] = useState(null);
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [batchQuery, setBatchQuery] = useState("");
  const [poQuery, setPoQuery] = useState("");
  const [showAddConsumable, setShowAddConsumable] = useState(false);
  const [selectedConsumableId, setSelectedConsumableId] = useState(null);
  const [consumableQuery, setConsumableQuery] = useState("");
  const [consumableAdjustTarget, setConsumableAdjustTarget] = useState(null);
  const [showAddPackageType, setShowAddPackageType] = useState(false);
  const [selectedPackageTypeId, setSelectedPackageTypeId] = useState(null);
  const [recipeQuery, setRecipeQuery] = useState("");
  const [adjustTarget, setAdjustTarget] = useState(null);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [selectedPOId, setSelectedPOId] = useState(null);
  const [showAddPO, setShowAddPO] = useState(false);
  const [editingPO, setEditingPO] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [selectedRecipeId, setSelectedRecipeId] = useState(null);
  const [missingIngredientsPrompt, setMissingIngredientsPrompt] = useState(null);
  const [showAddRecipe, setShowAddRecipe] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [showAddSalesOrder, setShowAddSalesOrder] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [showDeleteCompany, setShowDeleteCompany] = useState(false);
  const [brewRecipe, setBrewRecipe] = useState(null);
  const [batchPreset, setBatchPreset] = useState(null);
  const [editScheduledBatchId, setEditScheduledBatchId] = useState(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showIngredientsNeeded, setShowIngredientsNeeded] = useState(false);
  const [showQuickJump, setShowQuickJump] = useState(false);
  const [showHelpGuide, setShowHelpGuide] = useState(false);
  const [showAiHelper, setShowAiHelper] = useState(false);
  const [aiChatMessages, setAiChatMessages] = useState([]);
  const [showAiFeedbackReview, setShowAiFeedbackReview] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [textScale, setTextScale] = useState(() => {
    try {
      return localStorage.getItem("brewpoint-text-scale") || "1";
    } catch {
      return "1";
    }
  });
  const setTextScalePersist = (v) => {
    setTextScale(v);
    try {
      localStorage.setItem("brewpoint-text-scale", v);
    } catch {}
  };
  const [profile, setProfile] = useState(null);
  // Matches the existing role check already used for inviting/removing
  // teammates and deleting the company — anyone who isn't specifically
  // the owner is treated as staff for financial and destructive actions.
  const isOwner = profile?.role === "owner";
  const [auditShareScope, setAuditShareScope] = useState(null);

  const [showWelcomeTour, setShowWelcomeTour] = useState(false);
  useEffect(() => {
    if (!profile) return;
    if (!(profile.toursSeen || []).includes("welcome")) setShowWelcomeTour(true);
  }, [profile]);

  // Marks a tour (the welcome tour, or any single page's tour) as seen —
  // tied to the person's account rather than the device, so it follows
  // them wherever they log in, and each teammate gets their own first look
  // regardless of whether they're sharing a device with someone else.
  const markTourSeen = async (key) => {
    if (!profile) return;
    const toursSeen = [...new Set([...(profile.toursSeen || []), key])];
    setProfile((prev) => (prev ? { ...prev, toursSeen } : prev));
    try {
      await supabase.from("profiles").update({ tours_seen: toursSeen }).eq("id", profile.id);
    } catch {}
  };

  const dismissWelcomeTour = () => {
    setShowWelcomeTour(false);
    markTourSeen("welcome");
    try {
      // A brand-new account doesn't need a "what changed" recap on top of
      // the tour it just saw — mark the changelog seen too.
      localStorage.setItem("brewpoint-changelog-seen", String(LATEST_CHANGELOG_ID));
    } catch {}
  };

  // Same spotlight mechanism as the welcome tour, but scoped to a single
  // page — fires the first time this account lands on a page that has one.
  // Skips while the welcome tour itself is showing, so a brand-new account
  // isn't hit by two overlapping tours.
  const [pageTourKey, setPageTourKey] = useState(null);
  useEffect(() => {
    if (showWelcomeTour) return;
    if (!profile) return;
    if (!PAGE_TOURS[view]) return;
    if (!(profile.toursSeen || []).includes(view)) setPageTourKey(view);
  }, [view, showWelcomeTour, profile]);
  const dismissPageTour = () => {
    if (pageTourKey) markTourSeen(pageTourKey);
    setPageTourKey(null);
  };

  const [showWhatsNew, setShowWhatsNew] = useState(false);
  useEffect(() => {
    if (!profile) return;
    try {
      const isFirstVisit = !(profile.toursSeen || []).includes("welcome");
      if (isFirstVisit) return;
      const lastSeen = Number(localStorage.getItem("brewpoint-changelog-seen") || "0");
      if (lastSeen < LATEST_CHANGELOG_ID) setShowWhatsNew(true);
    } catch {}
  }, [profile]);
  const dismissWhatsNew = () => {
    setShowWhatsNew(false);
    try {
      localStorage.setItem("brewpoint-changelog-seen", String(LATEST_CHANGELOG_ID));
    } catch {}
  };
  const [companyName, setCompanyName] = useState("");
  const [companyLogo, setCompanyLogo] = useState("");
  const [xeroConnection, setXeroConnection] = useState(null);
  const [xeroConnecting, setXeroConnecting] = useState(false);
  const [xeroSettings, setXeroSettings] = useState(null);
  const [xeroItemMappings, setXeroItemMappings] = useState([]);
  const [xeroSalesMap, setXeroSalesMap] = useState([]);
  const [xeroSalesSyncing, setXeroSalesSyncing] = useState(false);
  const [xeroUnmatched, setXeroUnmatched] = useState([]);
  const [xeroMatchItems, setXeroMatchItems] = useState(null);
  const [xeroCompareItems, setXeroCompareItems] = useState(null);
  const [xeroAccounts, setXeroAccounts] = useState([]);
  const [xeroItems, setXeroItems] = useState([]);
  const [xeroContacts, setXeroContacts] = useState([]);
  const [xeroContactLinkTarget, setXeroContactLinkTarget] = useState(null);
  const [xeroMappingQueue, setXeroMappingQueue] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [salesOrders, setSalesOrders] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [supplierDocuments, setSupplierDocuments] = useState([]);
  const [showSuppliersModal, setShowSuppliersModal] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [deleteSupplierTarget, setDeleteSupplierTarget] = useState(null);
  const [scaleRecipeTarget, setScaleRecipeTarget] = useState(null);
  const [viewingSupplierDocs, setViewingSupplierDocs] = useState(null);
  const [foodSafetyDisclaimerAcceptedAt, setFoodSafetyDisclaimerAcceptedAt] = useState(null);
  const [salesModuleEnabled, setSalesModuleEnabled] = useState(true);
  const [barrelAgingModuleEnabled, setBarrelAgingModuleEnabled] = useState(true);
  const [exciseAbvMethod, setExciseAbvMethod] = useState("measured");
  const [brewPlanSettings, setBrewPlanSettings] = useState(null);
  const [ciderFocus, setCiderFocus] = useState(null);
  const [labelStrengths, setLabelStrengths] = useState({});
  const [beerAliases, setBeerAliasesState] = useState({});
  const [showSameBeer, setShowSameBeer] = useState(false);
  const setBeerAliases = (map) => { setBeerAliasMap(map); setBeerAliasesState(map); };
  const [teammates, setTeammates] = useState([]);
  const [inviteLink, setInviteLink] = useState("");
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [tanks, setTanks] = useState([]);
  const [showAddTank, setShowAddTank] = useState(false);
  const [stockTakes, setStockTakes] = useState([]);
  const [foodSafetyRecords, setFoodSafetyRecords] = useState([]);
  const [activeChecklistTemplate, setActiveChecklistTemplate] = useState(null);
  const [showCalibrationModal, setShowCalibrationModal] = useState(false);
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [showPestStationsModal, setShowPestStationsModal] = useState(false);
  const [showLogPestCheckModal, setShowLogPestCheckModal] = useState(false);
  const [showContractorVisitModal, setShowContractorVisitModal] = useState(false);
  const [showVerifierVisitModal, setShowVerifierVisitModal] = useState(false);
  const [showComplaintModal, setShowComplaintModal] = useState(false);
  const [showMockRecallModal, setShowMockRecallModal] = useState(false);
  const [showInternalAuditModal, setShowInternalAuditModal] = useState(false);
  const [showTastingLog, setShowTastingLog] = useState(false);
  const [showSensoryScore, setShowSensoryScore] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [showHarvestYeast, setShowHarvestYeast] = useState(false);
  const [addingIngredientToTank, setAddingIngredientToTank] = useState(null);
  const [showAddBatchIngredient, setShowAddBatchIngredient] = useState(false);
  const [showAddBrewDay, setShowAddBrewDay] = useState(false);
  const [showTrainingModal, setShowTrainingModal] = useState(false);
  const [showIllnessModal, setShowIllnessModal] = useState(false);
  const [activeNoteModal, setActiveNoteModal] = useState(null);
  const [viewingStaffTraining, setViewingStaffTraining] = useState(null);
  const [showStockTake, setShowStockTake] = useState(false);
  const [showStockTakeHistory, setShowStockTakeHistory] = useState(false);
  const [viewingStockTake, setViewingStockTake] = useState(null);
  const [showConsumablesStockTake, setShowConsumablesStockTake] = useState(false);
  const [showConsumablesStockTakeHistory, setShowConsumablesStockTakeHistory] = useState(false);
  const [viewingConsumablesStockTake, setViewingConsumablesStockTake] = useState(null);
  const [showFinishedStockTake, setShowFinishedStockTake] = useState(false);
  const [showFinishedStockTakeHistory, setShowFinishedStockTakeHistory] = useState(false);
  const [viewingFinishedStockTake, setViewingFinishedStockTake] = useState(null);
  const [editTankTarget, setEditTankTarget] = useState(null);
  const [deleteTankTarget, setDeleteTankTarget] = useState(null);
  const [deleteRecipeTarget, setDeleteRecipeTarget] = useState(null);
  const [editRecipeTarget, setEditRecipeTarget] = useState(null);
  const [deleteBatchTarget, setDeleteBatchTarget] = useState(null);
  const [assignTankTarget, setAssignTankTarget] = useState(null);
  const [vesselTransferTarget, setVesselTransferTarget] = useState(null);
  const [editSplitTanksTarget, setEditSplitTanksTarget] = useState(null);
  const [convertSplitTarget, setConvertSplitTarget] = useState(null);
  const [fermenterTransferTarget, setFermenterTransferTarget] = useState(null);
  const [startPackagingTarget, setStartPackagingTarget] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const askConfirm = (message, onConfirm, opts = {}) => setConfirmTarget({ message, onConfirm, ...opts });
  const [diacetylTestTarget, setDiacetylTestTarget] = useState(null);

  // Watch the Supabase auth session. This runs once and fires again on
  // sign-in, sign-out, or token refresh — session becomes null on sign-out.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Confirmation links auto-sign the user in via the token in the URL —
  // strip it out and sign back out so they land on a proper sign-in
  // screen instead of skipping straight past it.
  useEffect(() => {
    if (!justConfirmedEmail) return;
    window.history.replaceState(null, "", window.location.pathname);
    supabase.auth.signOut();
  }, [justConfirmedEmail]);

  const user = session
    ? { id: session.user.id, email: session.user.email, name: session.user.user_metadata?.name || session.user.email.split("@")[0] }
    : null;

  // Load every table for the signed-in user once we have a session.
  useEffect(() => {
    if (!user) {
      setBatches([]);
      setActivityLog([]);
      setInventory([]);
      setConsumables([]);
      setPackageTypes([]);
      setPurchaseOrders([]);
      setRecipes([]);
      setProfile(null);
      setCompanyName("");
      setCompanyLogo("");
      setFoodSafetyDisclaimerAcceptedAt(null);
      setTeammates([]);
      setTanks([]);
      setStockTakes([]);
      setFoodSafetyRecords([]);
      setXeroConnection(null);
      setXeroSettings(null);
      setXeroItemMappings([]);
      setSuppliers([]);
      setSupplierDocuments([]);
      return;
    }
    let cancelled = false;
    setLoadingData(true);
    (async () => {
      try {
      // Every account belongs to a company. If this is the very first time
      // this user has ever loaded the app, they won't have a profile row
      // yet — create/join their company now using what they entered at
      // sign-up (stashed in their auth metadata).
      let profileRow = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (!profileRow.data) {
        const meta = session.user.user_metadata || {};
        const memberName = meta.name || user.email.split("@")[0];
        const { error: joinError } = meta.inviteToken
          ? await supabase.rpc("join_via_invite", { invite_token: meta.inviteToken, member_name: memberName })
          : await supabase.rpc("join_or_create_company", { company_name: meta.company || "My Brewery", member_name: memberName });
        if (joinError) { showToast("error", meta.inviteToken ? "That invite link didn't work — check your connection and try again." : "Something didn't save — check your connection and try again."); }
        profileRow = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      }
      if (cancelled) return;
      if (!profileRow.data) {
        setLoadingData(false);
        return;
      }
      const myProfile = rowToProfile(profileRow.data);
      setProfile(myProfile);

      const [companyRes, teammatesRes, batchesRes, inventoryRes, consumablesRes, packageTypesRes, poRes, recipesRes, tanksRes, stockTakesRes, foodSafetyRes, xeroRes, xeroSettingsRes, xeroMappingsRes, suppliersRes, supplierDocsRes, activityRes, customersRes, salesOrdersRes, remindersRes, customerPricesRes, yeastHarvestsRes, mixedPackTypesRes, mixedPackAssembliesRes, pestStationsRes, exciseItemCodesRes, aiFeedbackRes, kegsRes, triangleTestsRes, exciseReturnsRes] = await Promise.all([
        supabase.from("companies").select("name, logo_url, food_safety_disclaimer_accepted_at, food_safety_disclaimer_accepted_by, sales_module_enabled, barrel_aging_module_enabled, excise_abv_method").eq("id", myProfile.companyId).single(),
        supabase.from("profiles").select("*").eq("company_id", myProfile.companyId),
        supabase.from("batches").select("*").order("created_at", { ascending: false }),
        supabase.from("inventory_items").select("*").order("created_at", { ascending: false }),
        supabase.from("consumables").select("*").order("created_at", { ascending: false }),
        supabase.from("package_types").select("*").order("created_at", { ascending: false }),
        supabase.from("purchase_orders").select("*").order("created_at", { ascending: false }),
        supabase.from("recipes").select("*").order("created_at", { ascending: false }),
        supabase.from("tanks").select("*").order("created_at", { ascending: false }),
        supabase.from("stock_takes").select("*").order("created_at", { ascending: false }),
        supabase.from("food_safety_records").select("*").order("created_at", { ascending: false }),
        supabase.from("xero_connections").select("*").eq("company_id", myProfile.companyId).maybeSingle(),
        supabase.from("xero_settings").select("*").eq("company_id", myProfile.companyId).maybeSingle(),
        supabase.from("xero_item_mappings").select("*").eq("company_id", myProfile.companyId),
        supabase.from("suppliers").select("*").order("name", { ascending: true }),
        supabase.from("supplier_documents").select("*").order("uploaded_at", { ascending: false }),
        supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(50),
        supabase.from("customers").select("*").order("name", { ascending: true }),
        supabase.from("sales_orders").select("*").order("created_at", { ascending: false }),
        supabase.from("reminders").select("*").order("due_date", { ascending: true }),
        supabase.from("customer_prices").select("*"),
        supabase.from("yeast_harvests").select("*").order("harvest_date", { ascending: false }),
        supabase.from("mixed_pack_types").select("*"),
        supabase.from("mixed_pack_assemblies").select("*").order("assembled_date", { ascending: false }),
        supabase.from("pest_stations").select("*").order("label", { ascending: true }),
        supabase.from("excise_item_codes").select("*"),
        supabase.from("ai_helper_feedback").select("*").order("created_at", { ascending: false }),
        supabase.from("kegs").select("*").order("keg_number", { ascending: true }),
        supabase.from("triangle_tests").select("*").order("test_date", { ascending: false }),
        supabase.from("excise_returns").select("*").order("period", { ascending: false }),
      ]);
      if (cancelled) return;
      if (companyRes.error) {
        console.error(companyRes.error);
      } else if (!companyRes.data) {
        console.error("Company load returned no error, but also no data.");
      } else {
        setCompanyName(companyRes.data.name);
        setCompanyLogo(companyRes.data.logo_url || "");
        setFoodSafetyDisclaimerAcceptedAt(companyRes.data.food_safety_disclaimer_accepted_at || null);
        setSalesModuleEnabled(companyRes.data.sales_module_enabled !== false);
        setBarrelAgingModuleEnabled(companyRes.data.barrel_aging_module_enabled !== false);
        setExciseAbvMethod(companyRes.data.excise_abv_method || "measured");
      }
      if (teammatesRes.error) console.error(teammatesRes.error);
      else setTeammates(teammatesRes.data.map(rowToProfile));
      if (batchesRes.error) console.error(batchesRes.error);
      else setBatches(batchesRes.data.map(rowToBatch));
      if (inventoryRes.error) console.error(inventoryRes.error);
      else setInventory(inventoryRes.data.map(rowToInventoryItem));
      if (consumablesRes.error) console.error(consumablesRes.error);
      else setConsumables(consumablesRes.data.map(rowToConsumable));
      if (packageTypesRes.error) console.error(packageTypesRes.error);
      else setPackageTypes(packageTypesRes.data.map(rowToPackageType));
      if (poRes.error) console.error(poRes.error);
      else setPurchaseOrders(poRes.data.map(rowToPO));
      if (recipesRes.error) console.error(recipesRes.error);
      else setRecipes(recipesRes.data.map(rowToRecipe));
      if (tanksRes.error) console.error(tanksRes.error);
      else setTanks(tanksRes.data.map(rowToTank));
      if (xeroSettingsRes.error) console.error(xeroSettingsRes.error);
      else setXeroSettings(xeroSettingsRes.data || null);
      if (xeroMappingsRes.error) console.error(xeroMappingsRes.error);
      else setXeroItemMappings(xeroMappingsRes.data || []);
      if (stockTakesRes.error) console.error(stockTakesRes.error);
      else setStockTakes(stockTakesRes.data.map(rowToStockTake));
      if (xeroRes.error) console.error(xeroRes.error);
      else setXeroConnection(xeroRes.data || null);
      if (foodSafetyRes.error) console.error(foodSafetyRes.error);
      else setFoodSafetyRecords(foodSafetyRes.data.map(rowToFoodSafetyRecord));
      if (suppliersRes.error) console.error(suppliersRes.error);
      else setSuppliers(suppliersRes.data.map(rowToSupplier));
      if (supplierDocsRes.error) console.error(supplierDocsRes.error);
      else setSupplierDocuments(supplierDocsRes.data.map(rowToSupplierDocument));
      if (activityRes.error) console.error(activityRes.error);
      else setActivityLog(activityRes.data.map(rowToActivity));
      if (customersRes.error) console.error(customersRes.error);
      else setCustomers(customersRes.data.map(rowToCustomer));
      if (salesOrdersRes.error) console.error(salesOrdersRes.error);
      else setSalesOrders(salesOrdersRes.data.map(rowToSalesOrder));
      if (remindersRes.error) console.error(remindersRes.error);
      else setReminders(remindersRes.data.map(rowToReminder));
      if (customerPricesRes.error) console.error(customerPricesRes.error);
      else setCustomerPrices(customerPricesRes.data.map(rowToCustomerPrice));
      if (yeastHarvestsRes.error) console.error(yeastHarvestsRes.error);
      else setYeastHarvests(yeastHarvestsRes.data.map(rowToYeastHarvest));
      if (mixedPackTypesRes.error) console.error(mixedPackTypesRes.error);
      else setMixedPackTypes(mixedPackTypesRes.data.map(rowToMixedPackType));
      if (mixedPackAssembliesRes.error) console.error(mixedPackAssembliesRes.error);
      else setMixedPackAssemblies(mixedPackAssembliesRes.data.map(rowToMixedPackAssembly));
      if (pestStationsRes.error) console.error(pestStationsRes.error);
      else setPestStations(pestStationsRes.data.map(rowToPestStation));
      if (exciseItemCodesRes.error) console.error(exciseItemCodesRes.error);
      else setExciseItemCodes(exciseItemCodesRes.data.map(rowToExciseItemCode));

      if (aiFeedbackRes.error) console.error(aiFeedbackRes.error);
      else setAiFeedback(aiFeedbackRes.data.map(rowToAiFeedback));

      if (kegsRes.error) console.error(kegsRes.error);
      else setKegs(kegsRes.data.map(rowToKeg));

      if (triangleTestsRes.error) console.error(triangleTestsRes.error);
      else setTriangleTests(triangleTestsRes.data.map(rowToTriangleTest));
      // Self-audit is optional — if the table hasn't been created yet the
      // rest of the app still loads normally.
      if (exciseReturnsRes.error) console.error(exciseReturnsRes.error);
      else setExciseReturns(exciseReturnsRes.data.map(rowToExciseReturn));
      // Which Xero item is which beer — optional, like the self-audit.
      const salesMapRes = await supabase.from("xero_sales_item_map").select("*").eq("company_id", myProfile.companyId);
      if (salesMapRes.error) console.error(salesMapRes.error);
      else if (!cancelled) setXeroSalesMap(salesMapRes.data || []);
      } catch (err) {
        // Whatever went wrong, never leave the app stuck on the loading
        // skeleton forever — surface it and let the user try again.
        console.error(err);
        if (!cancelled) showToast("error", "Something went wrong loading your data — check your connection and try refreshing.");
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // If the app was opened via a tank's QR code, jump straight to whatever's
  // currently in it (or the Brewery list if it's empty) once data is ready.
  useEffect(() => {
    if (!tankParam || loadingData || tanks.length === 0) return;
    const tank = tanks.find((t) => t.id === tankParam);
    if (!tank) return;
    const occupant = occupyingBatch(batches, tank.id);
    if (occupant) {
      if (occupant.startDate > today()) {
        setEditScheduledBatchId(occupant.id);
        setView("production");
      } else {
        setSelectedId(occupant.id);
        setView("batches");
      }
    } else {
      setView("brewery");
    }
  }, [tankParam, loadingData]);

  const selected = useMemo(() => batches.find((b) => b.id === selectedId) || null, [batches, selectedId]);

  // Tracks the last few batches opened, purely for the "Recently viewed"
  // strip on Home — local to this device, not synced.
  const [recentBatchIds, setRecentBatchIds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("brewpoint-recent-batches") || "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    if (!selected) return;
    setRecentBatchIds((prev) => {
      if (prev[0] === selected.id) return prev;
      const next = [selected.id, ...prev.filter((id) => id !== selected.id)].slice(0, 6);
      try {
        localStorage.setItem("brewpoint-recent-batches", JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [selected?.id]);
  const recentBatches = recentBatchIds.map((id) => batches.find((b) => b.id === id)).filter(Boolean);
  const nextNumber = useMemo(() => String(Math.max(0, ...batches.map((b) => parseInt(b.number, 10) || 0)) + 1), [batches]);
  // Cider batches have their own run: F0001, F0002, … (split tanks add A/B as usual).
  const nextCiderNumber = useMemo(() => {
    const n = Math.max(0, ...batches.map((b) => { const m = /^F(\d+)/i.exec(String(b.number || "")); return m ? parseInt(m[1], 10) : 0; }));
    return `F${String(n + 1).padStart(4, "0")}`;
  }, [batches]);
  const selectedPO = useMemo(() => purchaseOrders.find((p) => p.id === selectedPOId) || null, [purchaseOrders, selectedPOId]);
  const nextPONumber = useMemo(() => {
    const nums = purchaseOrders.map((p) => parseInt((p.poNumber.match(/\d+/) || [0])[0], 10) || 0);
    return `PO-${Math.max(100, ...nums) + 1}`;
  }, [purchaseOrders]);
  const nextSalesOrderNumber = useMemo(() => {
    const nums = salesOrders.map((o) => parseInt(((o.orderNumber || "").match(/\d+/) || [0])[0], 10) || 0);
    return `SO-${Math.max(100, ...nums) + 1}`;
  }, [salesOrders]);
  const [selectedSalesOrderId, setSelectedSalesOrderId] = useState(null);
  const [fulfillmentTarget, setFulfillmentTarget] = useState(null);
  const [printOrderTarget, setPrintOrderTarget] = useState(null);
  const [selectedKegId, setSelectedKegId] = useState(null);
  const [showAddKegs, setShowAddKegs] = useState(false);
  const [deleteKegTarget, setDeleteKegTarget] = useState(null);
  const [reorderItem, setReorderItem] = useState(null);
  const [showImportXeroContacts, setShowImportXeroContacts] = useState(false);
  const [showXeroProductMapping, setShowXeroProductMapping] = useState(false);
  const selectedSalesOrder = useMemo(() => salesOrders.find((o) => o.id === selectedSalesOrderId) || null, [salesOrders, selectedSalesOrderId]);
  const availableStock = useMemo(() => availableStockList(batches, salesOrders, mixedPackAssemblies), [batches, salesOrders, mixedPackAssemblies]);
  const mixedPackStock = useMemo(
    () => mixedPackStockList(mixedPackTypes, mixedPackAssemblies, salesOrders),
    [mixedPackTypes, mixedPackAssemblies, salesOrders]
  );
  const selectedRecipe = useMemo(() => recipes.find((r) => r.id === selectedRecipeId) || null, [recipes, selectedRecipeId]);
  const selectedInventoryItem = useMemo(
    () => inventory.find((it) => it.id === selectedInventoryId) || null,
    [inventory, selectedInventoryId]
  );
  const selectedConsumableItem = useMemo(
    () => consumables.find((it) => it.id === selectedConsumableId) || null,
    [consumables, selectedConsumableId]
  );
  const selectedPackageType = useMemo(
    () => packageTypes.find((pt) => pt.id === selectedPackageTypeId) || null,
    [packageTypes, selectedPackageTypeId]
  );
  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  // Fire-and-forget: records a line in the activity feed. Never blocks or
  // fails the action it's attached to — if this insert fails, the real
  // action already succeeded, so we just log it and move on.
  const logActivity = (action, entityType, entityName, description) => {
    const entry = {
      id: uid(),
      action,
      entityType,
      entityName,
      description,
      userName: user?.name || "Someone",
      createdAt: new Date().toISOString(),
    };
    setActivityLog((prev) => [entry, ...prev].slice(0, 50));
    supabase
      .from("activity_log")
      .insert(activityToRow(entry, user.id, profile.companyId))
      .then(({ error }) => {
        if (error) console.error(error);
      });
  };

  const addReminder = async (text, dueDate) => {
    const row = reminderToRow({ text, dueDate, done: false }, user.id, user.name, profile.companyId);
    delete row.id; // let Postgres generate the real UUID, same fix as customers/sales_orders
    const { data, error } = await supabase.from("reminders").insert(row).select().single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setReminders((prev) => [...prev, rowToReminder(data)].sort((a, b) => a.dueDate.localeCompare(b.dueDate)));
  };

  const toggleReminderDone = async (id, done) => {
    const patch = { done, done_by: done ? user.name : null };
    const { error } = await supabase.from("reminders").update(patch).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setReminders((prev) => prev.map((r) => (r.id === id ? { ...r, done, doneBy: done ? user.name : null } : r)));
  };

  const deleteReminder = async (id) => {
    const { error } = await supabase.from("reminders").delete().eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setReminders((prev) => prev.filter((r) => r.id !== id));
  };

  const createInvite = async () => {
    setCreatingInvite(true);
    const { data, error } = await supabase.rpc("create_company_invite");
    setCreatingInvite(false);
    if (error) { console.error(error); showToast("error", `Couldn't create an invite link: ${error.message || "unknown error"}`); return; }
    setInviteLink(`${window.location.origin}${window.location.pathname}?invite=${data}`);
  };

  const updateTeammateRole = async (teammate, newRole) => {
    const { error } = await supabase.rpc("update_teammate_role", { member_id: teammate.id, new_role: newRole });
    if (error) { showToast("error", `Couldn't update ${teammate.name}'s role: ${error.message || "unknown error"}`); return; }
    setTeammates((prev) => prev.map((t) => (t.id === teammate.id ? { ...t, role: newRole } : t)));
    if (teammate.id === user.id) setProfile((prev) => (prev ? { ...prev, role: newRole } : prev));
    showToast("success", `${teammate.name} is now ${newRole === "owner" ? "an owner" : "a member"}.`);
  };

  const removeTeammate = (teammate) => {
    askConfirm(
      `Remove ${teammate.name} from the team? They'll lose access to this company immediately.`,
      () => {
        setTeammates((prev) => prev.filter((t) => t.id !== teammate.id));
        const timeoutId = setTimeout(async () => {
          delete pendingDeletesRef.current[teammate.id];
          const { error } = await supabase.rpc("remove_teammate", { member_id: teammate.id });
          if (error) { showToast("error", `Couldn't remove ${teammate.name}: ${error.message || "unknown error"}`); setTeammates((prev) => [teammate, ...prev]); }
        }, 5000);
        pendingDeletesRef.current[teammate.id] = timeoutId;
        showToast("success", `${teammate.name} removed from the team.`, {
          label: "Undo",
          onClick: () => {
            clearTimeout(pendingDeletesRef.current[teammate.id]);
            delete pendingDeletesRef.current[teammate.id];
            setTeammates((prev) => [teammate, ...prev]);
          },
        });
      },
      { confirmLabel: "Remove", destructive: true }
    );
  };

  // Same bucket batch photos already use — just object storage, no reason
  // to stand up a separate one for a different kind of record.
  const uploadFoodSafetyPhoto = async (file) => {
    const path = `${profile.companyId}/food-safety/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("batch-photos").upload(path, file);
    if (error) {
      showToast("error", `Couldn't upload photo: ${error.message || "unknown error"}`);
      return null;
    }
    const { data } = supabase.storage.from("batch-photos").getPublicUrl(path);
    return data.publicUrl;
  };

  const uploadBatchPhoto = async (batchId, file) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;
    const path = `${profile.companyId}/${batchId}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("batch-photos").upload(path, file);
    if (uploadError) { showToast("error", `Couldn't upload photo: ${uploadError.message || "unknown error"}`); return; }
    const { data } = supabase.storage.from("batch-photos").getPublicUrl(path);
    const photos = [...(batch.photos || []), data.publicUrl];
    const { error } = await supabase.from("batches").update({ photos }).eq("id", batchId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, photos } : b)));
  };

  const deleteBatchPhoto = async (batchId, url) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;
    const photos = (batch.photos || []).filter((p) => p !== url);
    const { error } = await supabase.from("batches").update({ photos }).eq("id", batchId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, photos } : b)));
  };

  // Timers store an absolute end time (not a countdown), so any device that
  // loads the batch computes the correct time remaining on its own — no
  // live sync needed, just a shared source of truth.
  const startBrewTimer = async (batchId, label, minutes) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;
    const timers = [...(batch.timers || []), { id: uid(), label, endTime: Date.now() + minutes * 60000 }];
    const { error } = await supabase.from("batches").update({ timers }).eq("id", batchId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, timers } : b)));
  };

  const stopBrewTimer = async (batchId, timerId) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;
    const timers = (batch.timers || []).filter((t) => t.id !== timerId);
    const { error } = await supabase.from("batches").update({ timers }).eq("id", batchId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, timers } : b)));
  };

  const addBatch = async (input) => {
    // New batches get their beer's label strength, if one is set.
    let b = input;
    if (b.labelAbv == null) {
      const fam = Object.fromEntries(recipes.map((r) => [r.id, r.familyId || r.id]));
      const abv = labelStrengths[productKeyForBatch(b, fam)];
      if (abv != null) b = { ...b, labelAbv: abv };
    }
    // Work out which lots each ingredient will draw from — and their cost —
    // before creating the batch, so the batch record itself carries the
    // real ingredient cost from the moment it exists.
    let totalIngredientCost = 0;
    // One running total per stock item, so an item that appears on more
    // than one line (e.g. juice from two lots) is taken out line by line
    // from what's left, not each line from the same starting stock.
    const byItem = {};
    if (b.ingredients && b.ingredients.length > 0) {
      for (const ing of b.ingredients) {
        const item = inventory.find((it) => sameItemName(it.name, ing.name));
        if (!item) continue;
        const w = byItem[item.id] || (byItem[item.id] = { item, lots: item.lots, used: 0, lotsUsed: [] });
        const { updatedLots, lotsUsed, cost } = deductFromLotsFIFO(w.lots, ing.qty, ing.preferredLotId);
        totalIngredientCost += cost;
        w.lots = updatedLots;
        w.used += Number(ing.qty) || 0;
        w.lotsUsed.push(...lotsUsed);
      }
    }
    const plannedUpdates = Object.values(byItem).map((w) => ({ item: w.item, updatedLots: w.lots, lotsUsed: w.lotsUsed, used: w.used }));
    totalIngredientCost = Math.round(totalIngredientCost * 100) / 100;

    const { data, error } = await supabase
      .from("batches")
      .insert(batchToRow({ ...b, ingredientCost: totalIngredientCost }, user.id, profile.companyId))
      .select()
      .single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => [rowToBatch(data), ...prev]);
    showToast("success", `${b.name} created.`);
    logActivity("created", "batch", b.name, `${b.startDate > today() ? "Scheduled" : "Started"} batch ${b.name} (#${b.number})`);
    if (b.tankId) resetTankClean(b.tankId, b);
    (b.splitTanks || []).forEach((t) => resetTankClean(t.tankId, b));

    for (const { item, updatedLots, lotsUsed, used } of plannedUpdates) {
      const newQty = Math.max(0, Math.round((item.qty - used) * 100) / 100);
      const actualDelta = Math.round((newQty - item.qty) * 100) / 100;
      const historyEntry = {
        id: uid(),
        date: new Date().toISOString(),
        user: user.name,
        type: "batch",
        delta: actualDelta,
        note: `${b.name} (#${b.number})`,
        lots: lotsUsed,
      };
      const newHistory = [...(item.history || []), historyEntry];
      const { error: invError } = await supabase
        .from("inventory_items")
        .update({ qty: newQty, lots: updatedLots, history: newHistory })
        .eq("id", item.id);
      if (invError) { showToast("error", "Something didn't save — check your connection and try again."); }
      else setInventory((prev) => prev.map((it) => (it.id === item.id ? { ...it, qty: newQty, lots: updatedLots, history: newHistory } : it)));
    }
  };

  const updateScheduledBatch = async (id, patch) => {
    const row = {
      name: patch.name,
      style: patch.style,
      volume: patch.volume,
      start_date: patch.startDate,
      planned_days: patch.plannedDays,
      brew_days_planned: patch.brewDaysPlanned,
      tank_id: patch.tankId,
      tank_name: patch.tankName,
      split_tanks: patch.splitTanks,
      recipe_id: patch.recipeId,
      recipe_name: patch.recipeName,
      readings: patch.readings,
    };
    const { error } = await supabase.from("batches").update(row).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    showToast("success", "Schedule updated.");
  };

  const deleteBatch = async (id) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;

    // Remove from view immediately; the real inventory rollback + DB delete
    // are delayed so Undo can cancel them before anything actually happens.
    setBatches((prev) => prev.filter((b) => b.id !== id));
    setSelectedId(null);
    logActivity("deleted", "batch", batch.name, `${batch.name} (#${batch.number}) deleted`);

    const timeoutId = setTimeout(async () => {
      delete pendingDeletesRef.current[id];
      const batchTag = `${batch.name} (#${batch.number})`;

      let nextInventory = [...inventory];
      for (let i = 0; i < nextInventory.length; i++) {
        const item = nextInventory[i];
        const usageEntries = (item.history || []).filter((h) => h.type === "batch" && h.note === batchTag);
        if (usageEntries.length === 0) continue;

        let qty = item.qty;
        let lots = [...(item.lots || [])];
        const restoreHistory = [];

        usageEntries.forEach((entry) => {
          const restoreQty = Math.round(-entry.delta * 100) / 100;
          qty = Math.round((qty + restoreQty) * 100) / 100;
          (entry.lots || []).forEach((used) => {
            lots = lots.map((lot) =>
              lot.lotNumber === used.lotNumber
                ? { ...lot, remainingQty: Math.min(lot.qty, Math.round(((lot.remainingQty ?? lot.qty) + used.qty) * 100) / 100) }
                : lot
            );
          });
          restoreHistory.push({
            id: uid(),
            date: new Date().toISOString(),
            user: user.name,
            type: "restored",
            delta: restoreQty,
            note: `Batch deleted — ${batchTag}`,
          });
        });

        const newHistory = [...(item.history || []), ...restoreHistory];
        const { error: invError } = await supabase.from("inventory_items").update({ qty, lots, history: newHistory }).eq("id", item.id);
        if (invError) {
          showToast("error", "Something didn't save — check your connection and try again.");
          continue;
        }
        nextInventory[i] = { ...item, qty, lots, history: newHistory };
      }
      setInventory(nextInventory);

      // If this batch was started from a harvested yeast, deleting it
      // shouldn't strand that yeast as permanently "used" — free it back
      // up so it can genuinely be pitched again.
      if (batch.pitchedYeastHarvestId) {
        const { error: harvestError } = await supabase
          .from("yeast_harvests")
          .update({ used: false, used_in_batch_id: null, used_date: null })
          .eq("id", batch.pitchedYeastHarvestId);
        if (!harvestError) {
          setYeastHarvests((prev) =>
            prev.map((h) => (h.id === batch.pitchedYeastHarvestId ? { ...h, used: false, usedInBatchId: null, usedDate: null } : h))
          );
        }
      }

      const { error } = await supabase.from("batches").delete().eq("id", id);
      if (error) showToast("error", "Something didn't save — check your connection and try again.");
    }, 5000);

    pendingDeletesRef.current[id] = timeoutId;
    showToast("success", `${batch.name} deleted.`, {
      label: "Undo",
      onClick: () => {
        clearTimeout(pendingDeletesRef.current[id]);
        delete pendingDeletesRef.current[id];
        setBatches((prev) => [batch, ...prev]);
      },
    });
  };

  const addRecipe = async (r) => {
    const familyId = r.familyId || uid();
    const versionsInFamily = recipes.filter((rec) => rec.familyId === familyId);
    const version = versionsInFamily.length > 0 ? Math.max(...versionsInFamily.map((v) => v.version || 1)) + 1 : 1;
    const payload = { ...r, familyId, version, isActive: true };
    const { data, error } = await supabase.from("recipes").insert(recipeToRow(payload, user.id, profile.companyId)).select().single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    const newRecipe = rowToRecipe(data);

    if (versionsInFamily.length > 0) {
      const siblingIds = versionsInFamily.map((v) => v.id);
      const { error: deactivateError } = await supabase.from("recipes").update({ is_active: false }).in("id", siblingIds);
      if (deactivateError) { showToast("error", "Something didn't save — check your connection and try again."); }
    }

    setRecipes((prev) => [newRecipe, ...prev.map((rec) => (rec.familyId === familyId ? { ...rec, isActive: false } : rec))]);
    setSelectedRecipeId(newRecipe.id);
    logActivity("created", "recipe", newRecipe.name, `${version > 1 ? "New version of" : "Recipe"} ${newRecipe.name} saved`);

    const missing = findMissingIngredients(newRecipe.ingredients, inventory);
    if (missing.length > 0) setMissingIngredientsPrompt({ missing, sourceLabel: newRecipe.name, recipeId: newRecipe.id });

    return newRecipe;
  };

  // Same check as when a recipe's first saved, but callable anytime from
  // an existing recipe's own page — including one already brewing, since
  // "I just noticed this ingredient was never added" doesn't care what
  // stage the batch using it is at.
  const checkRecipeIngredients = (recipe) => {
    const missing = findMissingIngredients(recipe.ingredients, inventory);
    if (missing.length === 0) {
      showToast("success", "Every ingredient in this recipe is already in your Inventory.");
      return;
    }
    setMissingIngredientsPrompt({ missing, sourceLabel: recipe.name, recipeId: recipe.id });
  };

  // "This ingredient the recipe calls for isn't new — it's actually this
  // one already on the shelf, just spelled differently." Renames the
  // recipe's own ingredient line to match the existing item exactly,
  // rather than creating a duplicate in Inventory.
  const matchRecipeIngredient = async (recipeId, oldName, matchedItem) => {
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) return;
    const ingredients = recipe.ingredients.map((l) =>
      l.name.trim().toLowerCase() === oldName.trim().toLowerCase()
        ? { ...l, name: matchedItem.name, category: matchedItem.category, unit: matchedItem.unit }
        : l
    );
    const { error } = await supabase.from("recipes").update({ ingredients }).eq("id", recipeId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setRecipes((prev) => prev.map((r) => (r.id === recipeId ? { ...r, ingredients } : r)));
  };

  const saveAndBrewRecipe = async (r) => {
    const newRecipe = await addRecipe(r);
    if (!newRecipe) return;
    setBrewRecipe(newRecipe);
    setSelectedRecipeId(null);
    setView("batches");
    setShowAdd(true);
  };

  const scaleRecipe = (recipe, newVolume) => {
    const ratio = newVolume / recipe.volume;
    const scaledIngredients = recipe.ingredients.map((i) => ({ ...i, qty: Math.round(i.qty * ratio * 1000) / 1000 }));
    const scaledSchedule = (recipe.schedule || []).map((s) => ({ ...s, amount: Math.round((Number(s.amount) || 0) * ratio * 1000) / 1000 }));
    let scaledWaterChemistry = null;
    if (recipe.waterChemistry) {
      const saltGrams = Object.fromEntries(
        Object.entries(recipe.waterChemistry.saltGrams || {}).map(([k, v]) => [
          k,
          v === "" || v == null ? "" : Math.round(Number(v) * ratio * 100) / 100,
        ])
      );
      scaledWaterChemistry = { ...recipe.waterChemistry, saltGrams };
    }
    addRecipe({
      id: uid(),
      name: recipe.name,
      style: recipe.style,
      volume: newVolume,
      og: recipe.og,
      fg: recipe.fg,
      ingredients: scaledIngredients,
      schedule: scaledSchedule,
      familyId: recipe.familyId,
      efficiency: recipe.efficiency,
      boilTime: recipe.boilTime,
      waterChemistry: scaledWaterChemistry,
    });
  };

  const setActiveRecipeVersion = async (recipeId, familyId) => {
    const versionsInFamily = recipes.filter((rec) => rec.familyId === familyId);
    const otherIds = versionsInFamily.map((v) => v.id).filter((id) => id !== recipeId);
    const { error: activateError } = await supabase.from("recipes").update({ is_active: true }).eq("id", recipeId);
    if (activateError) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    if (otherIds.length > 0) {
      const { error: deactivateError } = await supabase.from("recipes").update({ is_active: false }).in("id", otherIds);
      if (deactivateError) { showToast("error", "Something didn't save — check your connection and try again."); }
    }
    setRecipes((prev) => prev.map((rec) => (rec.familyId === familyId ? { ...rec, isActive: rec.id === recipeId } : rec)));
  };

  const deleteRecipe = async (id) => {
    const recipe = recipes.find((r) => r.id === id);
    if (!recipe) return;
    setRecipes((prev) => prev.filter((r) => r.id !== id));
    setSelectedRecipeId(null);
    logActivity("deleted", "recipe", recipe.name, `${recipe.name} deleted`);
    const timeoutId = setTimeout(async () => {
      delete pendingDeletesRef.current[id];
      const { error } = await supabase.from("recipes").delete().eq("id", id);
      if (error) showToast("error", "Something didn't save — check your connection and try again.");
    }, 5000);
    pendingDeletesRef.current[id] = timeoutId;
    showToast("success", `${recipe.name} deleted.`, {
      label: "Undo",
      onClick: () => {
        clearTimeout(pendingDeletesRef.current[id]);
        delete pendingDeletesRef.current[id];
        setRecipes((prev) => [recipe, ...prev]);
      },
    });
  };

  const uploadCompanyLogo = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = async () => {
        const maxSize = 240;
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/png");
        const { error } = await supabase.from("companies").update({ logo_url: dataUrl }).eq("id", profile.companyId);
        if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
        setCompanyLogo(dataUrl);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const removeCompanyLogo = async () => {
    const { error } = await supabase.from("companies").update({ logo_url: null }).eq("id", profile.companyId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setCompanyLogo("");
  };

  const acceptFoodSafetyDisclaimer = async () => {
    const acceptedAt = new Date().toISOString();
    const { error } = await supabase
      .from("companies")
      .update({ food_safety_disclaimer_accepted_at: acceptedAt, food_safety_disclaimer_accepted_by: user.name })
      .eq("id", profile.companyId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setFoodSafetyDisclaimerAcceptedAt(acceptedAt);
  };

  // Sales (Customers + Orders) is a genuinely optional module — plenty of
  // breweries run their sales through something else entirely (Upstock,
  // spreadsheets, whatever), so this just hides the whole section rather
  // than forcing it on everyone.
  const toggleSalesModule = async (enabled) => {
    const { error } = await supabase.from("companies").update({ sales_module_enabled: enabled }).eq("id", profile.companyId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setSalesModuleEnabled(enabled);
    if (!enabled && (view === "customers" || view === "salesOrders")) setView("home");
  };

  const toggleBarrelAgingModule = async (enabled) => {
    const { error } = await supabase.from("companies").update({ barrel_aging_module_enabled: enabled }).eq("id", profile.companyId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBarrelAgingModuleEnabled(enabled);
    if (!enabled && view === "aging") setView("home");
  };

  useEffect(() => {
    if (!profile?.companyId) return;
    supabase
      .from("brew_plan_settings")
      .select("settings")
      .eq("company_id", profile.companyId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) console.error(error);
        setBrewPlanSettings(data?.settings || {});
      });
  }, [profile?.companyId]);
  useEffect(() => {
    if (!profile?.companyId) return;
    supabase
      .from("label_strengths")
      .select("product_key, abv")
      .eq("company_id", profile.companyId)
      .then(({ data, error }) => {
        if (error) { console.error(error); return; }
        setLabelStrengths(Object.fromEntries((data || []).map((r) => [r.product_key, Number(r.abv)])));
      });
  }, [profile?.companyId]);
  useEffect(() => {
    if (!profile?.companyId) return;
    supabase
      .from("beer_aliases")
      .select("batch_name, beer_name")
      .eq("company_id", profile.companyId)
      .then(({ data, error }) => {
        if (error) { console.error(error); return; }
        setBeerAliases(Object.fromEntries((data || []).map((r) => [String(r.batch_name).toLowerCase(), r.beer_name])));
      });
  }, [profile?.companyId]);
  const saveBeerAliases = async (draft) => {
    const del = await supabase.from("beer_aliases").delete().eq("company_id", profile.companyId);
    if (del.error) { console.error(del.error); showToast("error", "Something didn't save — check your connection and try again."); return false; }
    const rows = Object.entries(draft).map(([k, beer]) => ({ company_id: profile.companyId, batch_name: k, beer_name: beer }));
    if (rows.length) {
      const ins = await supabase.from("beer_aliases").insert(rows);
      if (ins.error) { console.error(ins.error); showToast("error", "Something didn't save — check your connection and try again."); return false; }
    }
    setBeerAliases(draft);
    showToast("success", rows.length ? `${rows.length} batch name${rows.length === 1 ? "" : "s"} grouped under another beer.` : "No names grouped.");
    return true;
  };

  // Save a beer's label strength and put it on the batches given (the
  // page only passes ones not in a month already declared on TSW).
  const saveLabelStrength = async (key, abv, batchIds, name) => {
    const { error } = await supabase.from("label_strengths").upsert({ company_id: profile.companyId, product_key: key, abv, updated_at: new Date().toISOString() });
    if (error) { console.error(error); showToast("error", "Something didn't save — check your connection and try again."); return; }
    setLabelStrengths((p) => ({ ...p, [key]: abv }));
    if (batchIds.length) {
      const { error: e2 } = await supabase.from("batches").update({ label_abv: abv }).in("id", batchIds);
      if (e2) { console.error(e2); showToast("error", "The strength saved, but the batches didn't update — try again."); return; }
      setBatches((prev) => prev.map((b) => (batchIds.includes(b.id) ? { ...b, labelAbv: abv } : b)));
    }
    showToast("success", `${name}: ${abv}%${batchIds.length ? ` set on ${batchIds.length} batch${batchIds.length === 1 ? "" : "es"}` : " saved for new batches"}.`);
  };

  const saveBrewPlanSettings = async (next) => {
    setBrewPlanSettings(next);
    const { error } = await supabase.from("brew_plan_settings").upsert({ company_id: profile.companyId, settings: next, updated_at: new Date().toISOString() });
    if (error) { console.error(error); showToast("error", "Something didn't save — check your connection and try again."); }
  };

  const updateExciseAbvMethod = async (method) => {
    const { error } = await supabase.from("companies").update({ excise_abv_method: method }).eq("id", profile.companyId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setExciseAbvMethod(method);
  };

  const disconnectXero = async () => {
    const { error } = await supabase.from("xero_connections").delete().eq("company_id", profile.companyId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setXeroConnection(null);
  };

  // Reads a photo or PDF of an invoice/docket via Claude's vision and
  // returns structured line items — the API key itself never reaches the
  // browser, it only ever lives in the Edge Function. mode is "order" (a
  // supplier invoice/PO) or "receiving" (a delivery docket, which may
  // have lot numbers printed on it that an order-stage document wouldn't).
  // Every Edge Function call below used to authenticate with the shared,
  // public anon key and just tell the function which company it was for
  // in the request body — meaning the function had no real way to know
  // who was actually asking, and had to trust whatever company was
  // claimed. This gets the caller's own genuine session token instead,
  // so the Edge Function can verify identity itself rather than trust
  // the client's word for it.
  const getAuthToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;
  };

  const extractDocument = async (file, mode) => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const token = await getAuthToken();
    const fileBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = () => reject(new Error("Couldn't read that file"));
      reader.readAsDataURL(file);
    });
    const res = await fetch(`${supabaseUrl}/functions/v1/extract-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: anonKey },
      body: JSON.stringify({ fileBase64, mediaType: file.type, mode }),
    });
    return res.json();
  };

  const askAiHelper = async (messages) => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const token = await getAuthToken();
    const res = await fetch(`${supabaseUrl}/functions/v1/ai-helper`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: anonKey },
      body: JSON.stringify({ messages, helpArticles: HELP_ARTICLES }),
    });
    return res.json();
  };

  const saveAiFeedback = async (question, answer) => {
    const entry = { userName: profile?.name || user.email, question, answer };
    const row = aiFeedbackToRow(entry, user.id, profile.companyId);
    delete row.id; // let Postgres generate the real UUID, same fix as pest_stations/customers/sales_orders
    const { data, error } = await supabase.from("ai_helper_feedback").insert(row).select().single();
    if (error) {
      console.error("ai_helper_feedback insert error:", error);
      showToast("error", `Couldn't save that feedback — ${error.message || "check your connection and try again"}.`);
      return false;
    }
    setAiFeedback((prev) => [rowToAiFeedback(data), ...prev]);
    return true;
  };

  const deleteAiFeedback = async (id) => {
    const { error } = await supabase.from("ai_helper_feedback").delete().eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setAiFeedback((prev) => prev.filter((f) => f.id !== id));
  };

  const [xeroNeedsReconnect, setXeroNeedsReconnect] = useState(false);
  const callXeroApi = async (action, extra) => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const token = await getAuthToken();
    const res = await fetch(`${supabaseUrl}/functions/v1/xero-api`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: anonKey },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await res.json();
    // Xero drops the link if it isn't refreshed for 60 days — say so plainly
    // instead of failing quietly in the background.
    if (data && typeof data.error === "string" && /reconnect|Not connected/i.test(data.error)) setXeroNeedsReconnect(true);
    else if (data && !data.error) setXeroNeedsReconnect(false);
    return data;
  };

  const loadXeroAccounts = async () => {
    const data = await callXeroApi("listAccounts");
    if (data.error) {
      showToast("error", "Something didn't save — check your connection and try again.");
      return;
    }
    setXeroAccounts(data.accounts || []);
  };

  // Opens the link-a-customer-to-Xero picker — fetches the current Xero
  // contact list fresh each time, since it's cheap and avoids showing a
  // stale list if someone's added contacts directly in Xero since.
  const openXeroContactLink = async (customer) => {
    setXeroContactLinkTarget(customer);
    const data = await callXeroApi("listContacts");
    if (data.error) {
      showToast("error", "Couldn't load Xero contacts — check your Xero connection.");
      return;
    }
    setXeroContacts(data.contacts || []);
  };

  // Xero's error detail can come back in a few different shapes depending
  // on what went wrong (auth failure vs. a rejected API call) — this
  // tries the fields that are actually likely to contain the human-
  // readable reason, falling back to the raw object if none match.
  const extractXeroErrorDetail = (detail) => {
    if (!detail) return "";
    if (typeof detail === "string") return detail;
    return detail.Detail || detail.Title || detail.error_description || detail.error || detail.Message || JSON.stringify(detail);
  };

  // Builds the full user-facing message for a failed Xero call. Xero's
  // own "AuthenticationUnsuccessful" (and similar) means the connection
  // itself has gone stale — a raw error code doesn't tell anyone what to
  // do about it, so this recognizes it specifically and points at the
  // actual fix (reconnect in Settings) instead.
  const xeroErrorMessage = (action, data) => {
    const extra = extractXeroErrorDetail(data.detail);
    if (/authenticationunsuccessful|unauthorized|invalid_grant|invalid_token/i.test(extra) || /authenticationunsuccessful|unauthorized/i.test(data.error || "")) {
      return `Couldn't ${action} — the Xero connection has gone stale. Go to Settings → Xero, disconnect, then reconnect.`;
    }
    return `Couldn't ${action} — ${data.error}${extra ? `: ${extra}` : ""}`;
  };

  const openXeroContactImport = async () => {
    setShowImportXeroContacts(true);
    const data = await callXeroApi("listContacts");
    if (data.error) {
      showToast("error", xeroErrorMessage("load Xero contacts", data));
      setShowImportXeroContacts(false);
      return;
    }
    setXeroContacts(data.contacts || []);
  };

  const openXeroProductMapping = async () => {
    setShowXeroProductMapping(true);
    const data = await callXeroApi("listItems");
    if (data.error) {
      showToast("error", xeroErrorMessage("load Xero items", data));
      setShowXeroProductMapping(false);
      return;
    }
    setXeroItems(data.items || []);
  };

  // Creates a new customer per selected Xero contact, already linked —
  // no separate link step needed afterward. Continues past any single
  // failure so one bad row doesn't block the rest of the batch.
  const importXeroContacts = async (contacts) => {
    let successCount = 0;
    const newCustomers = [];
    for (const c of contacts) {
      const payload = {
        name: c.name,
        email: c.email || c.emailAddress || null,
        xeroContactId: c.contactId,
        xeroContactName: c.name,
      };
      const row = customerToRow(payload, profile.companyId);
      delete row.id;
      const { data, error } = await supabase.from("customers").insert(row).select().single();
      if (error) { showToast("error", `Couldn't import ${c.name}.`); continue; }
      newCustomers.push(rowToCustomer(data));
      successCount++;
    }
    setCustomers((prev) => [...prev, ...newCustomers].sort((a, b) => a.name.localeCompare(b.name)));
    showToast("success", `${successCount} customer${successCount !== 1 ? "s" : ""} imported from Xero.`);
  };

  const linkCustomerToXero = async (customerId, xeroContactId, xeroContactName) => {
    const { error } = await supabase
      .from("customers")
      .update({ xero_contact_id: xeroContactId, xero_contact_name: xeroContactName })
      .eq("id", customerId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setCustomers((prev) => prev.map((c) => (c.id === customerId ? { ...c, xeroContactId, xeroContactName } : c)));
    setXeroContactLinkTarget(null);
    showToast("success", `Linked to ${xeroContactName} in Xero.`);
  };

  const unlinkCustomerFromXero = async (customerId) => {
    const { error } = await supabase.from("customers").update({ xero_contact_id: null, xero_contact_name: null }).eq("id", customerId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setCustomers((prev) => prev.map((c) => (c.id === customerId ? { ...c, xeroContactId: null, xeroContactName: null } : c)));
  };

  // A single random UUID is plenty of entropy for an unguessable link —
  // this is the only thing standing in for a password on the order page,
  // so regenerating it (below) is the way to revoke a link that's leaked.
  const generatePortalLink = async (customerId) => {
    const token = crypto.randomUUID();
    const { error } = await supabase.from("customers").update({ portal_token: token }).eq("id", customerId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setCustomers((prev) => prev.map((c) => (c.id === customerId ? { ...c, portalToken: token } : c)));
    showToast("success", "Order link created.");
  };

  // Creates the customer's real login (via Supabase Auth, same underlying
  // system staff accounts use) and returns a one-time link for them to set
  // their own password. That link is only good once — after that, they
  // just go to the shared /order page and log in normally from then on.
  const inviteCustomerToOrderOnline = async (customerId, email) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const staffJwt = sessionData?.session?.access_token;
      if (!staffJwt) {
        showToast("error", "Please sign in again and try.");
        return null;
      }
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/quick-endpoint`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}`, apikey: anonKey },
        body: JSON.stringify({ action: "generateInviteLink", staffJwt, customerId, email }),
      });
      const result = await res.json();
      if (result.error) {
        showToast("error", result.error);
        return null;
      }
      setCustomers((prev) => prev.map((c) => (c.id === customerId ? { ...c, authUserId: "pending" } : c)));
      return result.link;
    } catch (err) {
      console.error(err);
      showToast("error", `Couldn't reach the server: ${(err && err.message) || String(err)}`);
      return null;
    }
  };

  const saveCustomerPrice = async (customerId, productKey, unitPrice) => {
    const existing = customerPrices.find((p) => p.customerId === customerId && p.productKey === productKey);
    const row = customerPriceToRow({ id: existing?.id, customerId, productKey, unitPrice }, profile.companyId);
    if (!existing) delete row.id;
    const { data, error } = await supabase.from("customer_prices").upsert(row, { onConflict: "customer_id,product_key" }).select().single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    const saved = rowToCustomerPrice(data);
    setCustomerPrices((prev) => (existing ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved]));
  };

  // Creates a brand-new contact in Xero from a Brewpoint customer's
  // details, then immediately links the two — for a customer that doesn't
  // already exist in Xero at all.
  const createXeroContactForCustomer = async (customer) => {
    const result = await callXeroApi("createContact", { name: customer.name, email: customer.email || null });
    if (result.error) {
      showToast("error", "Couldn't create the Xero contact — check your Xero connection.");
      return;
    }
    await linkCustomerToXero(customer.id, result.contactId, result.contactName || customer.name);
  };

  const saveXeroAdjustmentAccount = async (code, name) => {
    const { error } = await supabase
      .from("xero_settings")
      .upsert({ ...(xeroSettings || {}), company_id: profile.companyId, adjustment_account_code: code, adjustment_account_name: name });
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setXeroSettings((prev) => ({ ...(prev || {}), company_id: profile.companyId, adjustment_account_code: code, adjustment_account_name: name }));
  };

  // productKeyFor moved to a global, top-level function so it can also be
  // used by the Xero product mapping modal, which lives outside this
  // component — see near CONTAINERS.

  const postPackagingLineToXero = async (batch, mapping, qty) => {
    // If the Xero item is a case (say 24 cans), send cases, not cans.
    const sales = xeroSalesMap.find((m) => String(m.xero_item_code).toLowerCase() === String(mapping.xero_item_code).toLowerCase() && !m.ignore);
    const per = Number(sales?.units_per_xero_unit) || 1;
    const quantity = Math.round((qty / per) * 10000) / 10000;
    const result = await callXeroApi("postStock", {
      itemCode: mapping.xero_item_code,
      quantity,
      direction: "increase",
      unitCost: mapping.unit_cost,
      adjustmentAccountCode: xeroSettings.adjustment_account_code,
      reference: `${batch.name} (#${batch.number})`,
    });
    if (result.error) console.error("Xero sync failed:", result.error, result.detail);
    return result;
  };

  const syncPackagingToXero = async (batch, sessionCounts) => {
    if (!xeroConnection || !xeroSettings?.adjustment_account_code) return;
    const lines = CONTAINERS.filter((c) => (sessionCounts[c.key] || 0) > 0).map((c) => ({
      containerKey: c.key,
      containerLabel: c.label,
      qty: sessionCounts[c.key],
      productKey: productKeyFor(batch.name, c.key),
      productLabel: `${batch.name} — ${c.label}`,
    }));
    if (lines.length === 0) return;

    const unmapped = lines.filter((l) => !xeroItemMappings.some((m) => m.product_key === l.productKey));
    if (unmapped.length > 0) {
      const data = await callXeroApi("listItems");
      setXeroItems(data.items || []);
      setXeroMappingQueue({ batch, lines });
      return;
    }

    for (const line of lines) {
      const mapping = xeroItemMappings.find((m) => m.product_key === line.productKey);
      await postPackagingLineToXero(batch, mapping, line.qty);
    }
  };

  const confirmXeroMappings = async (resolvedLines) => {
    const { batch } = xeroMappingQueue;
    const newMappings = [];
    for (const line of resolvedLines) {
      if (!line.itemCode) continue;
      const record = {
        id: uid(),
        company_id: profile.companyId,
        product_key: line.productKey,
        product_label: line.productLabel,
        xero_item_code: line.itemCode,
        xero_item_name: line.itemName,
        unit_cost: Number(line.unitCost) || 0,
      };
      const { error } = await supabase.from("xero_item_mappings").upsert(record, { onConflict: "company_id,product_key" });
      if (error) {
        showToast("error", "Something didn't save — check your connection and try again.");
        continue;
      }
      newMappings.push(record);
    }
    const updatedMappings = [...xeroItemMappings.filter((m) => !newMappings.some((n) => n.product_key === m.product_key)), ...newMappings];
    setXeroItemMappings(updatedMappings);

    for (const line of resolvedLines) {
      if (!line.itemCode) continue;
      const mapping = updatedMappings.find((m) => m.product_key === line.productKey);
      if (mapping) await postPackagingLineToXero(batch, mapping, line.qty);
    }
    setXeroMappingQueue(null);
  };

  // Same upsert as confirmXeroMappings, but for the proactive recipe
  // mapping flow — no actual packaging event happened, so there's
  // nothing to post to Xero yet, just the mapping itself for next time.
  const saveXeroProductMappings = async (lines) => {
    const newMappings = [];
    for (const line of lines) {
      const record = {
        id: uid(),
        company_id: profile.companyId,
        product_key: line.productKey,
        product_label: line.productLabel,
        xero_item_code: line.itemCode,
        xero_item_name: line.itemName,
        unit_cost: Number(line.unitCost) || 0,
      };
      const { error } = await supabase.from("xero_item_mappings").upsert(record, { onConflict: "company_id,product_key" });
      if (error) { showToast("error", "Something didn't save — check your connection and try again."); continue; }
      newMappings.push(record);
    }
    setXeroItemMappings((prev) => [...prev.filter((m) => !newMappings.some((n) => n.product_key === m.product_key)), ...newMappings]);
    showToast("success", `${newMappings.length} mapping${newMappings.length !== 1 ? "s" : ""} saved.`);
  };

  const completeStockTake = async (lines) => {
    const date = today();
    let nextInventory = [...inventory];

    for (const line of lines) {
      if (line.discrepancy === 0) continue;
      const idx = nextInventory.findIndex((it) => it.id === line.itemId);
      if (idx < 0) continue;
      const item = nextInventory[idx];
      const historyEntry = {
        id: uid(),
        date: new Date().toISOString(),
        user: user.name,
        type: "stocktake",
        delta: line.discrepancy,
        note: `Stock take ${date}`,
      };
      const newHistory = [...(item.history || []), historyEntry];
      const { error } = await supabase.from("inventory_items").update({ qty: line.countedQty, history: newHistory }).eq("id", item.id);
      if (error) {
        showToast("error", "Something didn't save — check your connection and try again.");
        continue;
      }
      nextInventory[idx] = { ...item, qty: line.countedQty, history: newHistory };
    }
    setInventory(nextInventory);

    const record = { id: uid(), date, userName: user.name, lines, type: "inventory" };
    const { data, error: stError } = await supabase
      .from("stock_takes")
      .insert(stockTakeToRow(record, user.id, profile.companyId))
      .select()
      .single();
    if (stError) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setStockTakes((prev) => [rowToStockTake(data), ...prev]);
  };

  // Same idea as completeStockTake, just walking the cans/kegs/labels
  // shelf instead of the ingredients shelf.
  const completeConsumablesStockTake = async (lines) => {
    const date = today();
    let nextConsumables = [...consumables];

    for (const line of lines) {
      if (line.discrepancy === 0) continue;
      const idx = nextConsumables.findIndex((it) => it.id === line.itemId);
      if (idx < 0) continue;
      const item = nextConsumables[idx];
      const historyEntry = {
        id: uid(),
        date: new Date().toISOString(),
        user: user.name,
        type: "stocktake",
        delta: line.discrepancy,
        note: `Stock take ${date}`,
      };
      const newHistory = [...(item.history || []), historyEntry];
      const { error } = await supabase.from("consumables").update({ qty: line.countedQty, history: newHistory }).eq("id", item.id);
      if (error) {
        showToast("error", "Something didn't save — check your connection and try again.");
        continue;
      }
      nextConsumables[idx] = { ...item, qty: line.countedQty, history: newHistory };
    }
    setConsumables(nextConsumables);

    const record = { id: uid(), date, userName: user.name, lines, type: "consumables" };
    const { data, error: stError } = await supabase
      .from("stock_takes")
      .insert(stockTakeToRow(record, user.id, profile.companyId))
      .select()
      .single();
    if (stError) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setStockTakes((prev) => [rowToStockTake(data), ...prev]);
  };

  // Writes packaged stock off in one go. Each affected batch gets an entry
  // with the same id, so the whole clear-out can be undone together.
  const updateStockCleared = async (changes) => {
    for (let i = 0; i < changes.length; i += 15) {
      const slice = changes.slice(i, i + 15);
      const results = await Promise.all(slice.map(({ id, stockCleared }) => supabase.from("batches").update({ stock_cleared: stockCleared }).eq("id", id)));
      if (results.some((r) => r.error)) {
        console.error(results.find((r) => r.error).error);
        return i + results.filter((r) => !r.error).length;
      }
    }
    return changes.length;
  };

  const clearPackagedStock = async (perBatch, reason) => {
    const clearId = uid();
    const entryFor = (counts) => ({ id: clearId, date: new Date().toISOString(), user: user?.name || "Someone", reason, counts });
    const changes = Object.entries(perBatch).map(([id, counts]) => {
      const b = batches.find((x) => x.id === id);
      return { id, stockCleared: [...(b?.stockCleared || []), entryFor(counts)] };
    });
    const done = await updateStockCleared(changes);
    const doneIds = new Set(changes.slice(0, done).map((c) => c.id));
    setBatches((prev) => prev.map((b) => (doneIds.has(b.id) ? { ...b, stockCleared: changes.find((c) => c.id === b.id).stockCleared } : b)));
    if (done < changes.length) {
      showToast("error", `Only part of the stock was cleared (${done} of ${changes.length} batches) — check your connection and try again.`);
      return false;
    }
    const units = Object.values(perBatch).reduce((s2, c) => s2 + Object.values(c).reduce((a, v) => a + v, 0), 0);
    logActivity("cleared", "stock", "Packaged stock", `Cleared ${units} units of packaged stock — ${reason}`);
    showToast("success", `Cleared ${units.toLocaleString("en-NZ")} units of packaged stock.`);
    return true;
  };

  const undoStockClear = async (clearId) => {
    const changes = batches
      .filter((b) => (b.stockCleared || []).some((e) => e.id === clearId))
      .map((b) => ({ id: b.id, stockCleared: (b.stockCleared || []).filter((e) => e.id !== clearId) }));
    const done = await updateStockCleared(changes);
    const doneIds = new Set(changes.slice(0, done).map((c) => c.id));
    setBatches((prev) => prev.map((b) => (doneIds.has(b.id) ? { ...b, stockCleared: changes.find((c) => c.id === b.id).stockCleared } : b)));
    if (done < changes.length) {
      showToast("error", "Only part of the clear-out was undone — check your connection and try again.");
      return;
    }
    logActivity("restored", "stock", "Packaged stock", "Undid a packaged stock clear-out");
    showToast("success", "Clear-out undone.");
  };

  // ─── Xero → Brewpoint: sales invoiced in Xero take stock off ─────────────
  const updateXeroSold = async (changes) => {
    for (let i = 0; i < changes.length; i += 15) {
      const slice = changes.slice(i, i + 15);
      const results = await Promise.all(slice.map(({ id, xeroSold }) => supabase.from("batches").update({ xero_sold: xeroSold }).eq("id", id)));
      if (results.some((r) => r.error)) {
        console.error(results.find((r) => r.error).error);
        return false;
      }
    }
    return true;
  };

  // Read older Xero invoices (before the sales check's start date) and
  // record who got which batch — for tracing only, stock isn't touched.
  const importXeroSalesHistory = async (fromDate) => {
    const beforeDate = xeroSettings?.sales_sync_from || today();
    if (!fromDate || fromDate >= beforeDate) { showToast("error", `Pick a date before ${beforeDate}.`); return false; }
    const data = await callXeroApi("listSales", { since: fromDate });
    if (data.error) {
      showToast("error", /reconnect|Not connected/i.test(String(data.error)) ? "Xero has disconnected — connect it again first." : "Couldn't read invoices from Xero — try again in a minute.");
      return false;
    }
    const { byBatch, summary } = planXeroSalesHistory({ docs: data.docs || [], beforeDate, salesMap: xeroSalesMap, itemMappings: xeroItemMappings, batches });
    // Replace any earlier import from the same range so running it again doesn't double up.
    const changes = batches
      .map((b) => {
        const kept = (b.salesHistory || []).filter((e) => !(e.source === "xero-history" && e.date >= fromDate && e.date < beforeDate));
        const next = [...kept, ...(byBatch[b.id] || [])];
        return JSON.stringify(next) === JSON.stringify(b.salesHistory || []) ? null : { id: b.id, salesHistory: next };
      })
      .filter(Boolean);
    for (let i = 0; i < changes.length; i += 15) {
      const results = await Promise.all(changes.slice(i, i + 15).map((c) => supabase.from("batches").update({ sales_history: c.salesHistory }).eq("id", c.id)));
      if (results.some((r) => r.error)) { console.error(results.find((r) => r.error).error); showToast("error", "Some batches didn't update — try again."); return false; }
    }
    const byId = Object.fromEntries(changes.map((c) => [c.id, c.salesHistory]));
    setBatches((prev) => prev.map((b) => (byId[b.id] ? { ...b, salesHistory: byId[b.id] } : b)));
    const parts = [`${summary.lines} invoice line${summary.lines === 1 ? "" : "s"} traced to batches`];
    if (summary.unmapped.length) parts.push(`${summary.unmapped.length} item code${summary.unmapped.length === 1 ? "" : "s"} not matched (${summary.unmapped.slice(0, 5).join(", ")}${summary.unmapped.length > 5 ? "…" : ""})`);
    if (summary.unplaced > 0) parts.push(`${summary.unplaced} unit${summary.unplaced === 1 ? "" : "s"} couldn't be placed on a batch`);
    showToast("success", parts.join(" · ") + ". Stock levels weren't changed.");
    logActivity("synced", "stock", "Xero sales history", parts.join(" · "));
    return true;
  };

  const xeroSalesSyncRunning = useRef(false);
  const syncSalesFromXero = async (quiet = false) => {
    if (!xeroConnection || !xeroSettings?.sales_sync_enabled || xeroSalesSyncRunning.current) return;
    xeroSalesSyncRunning.current = true;
    setXeroSalesSyncing(true);
    try {
      const since = xeroSettings.sales_sync_from || today();
      const data = await callXeroApi("listSales", { since });
      if (data.error) {
        console.error("Xero sales check failed:", data.error, data.detail);
        if (!quiet) showToast("error", /reconnect|Not connected/i.test(String(data.error)) ? "Xero has disconnected — connect it again in Settings." : "Couldn't read sales from Xero just now — try again in a minute.");
        return;
      }
      const ledgerRes = await supabase.from("xero_stock_sales").select("*").eq("company_id", profile.companyId);
      if (ledgerRes.error) {
        console.error(ledgerRes.error);
        if (!quiet) showToast("error", "Something didn't load — check your connection and try again.");
        return;
      }
      const plan = planXeroSales({
        docs: data.docs || [],
        ledger: ledgerRes.data || [],
        salesMap: xeroSalesMap,
        itemMappings: xeroItemMappings,
        batches,
        available: availableStock,
        brewpointOrderNumbers: salesOrders.map((o) => o.orderNumber),
      });
      // Ledger first, so a half-finished run can't take the same stock twice.
      if (plan.rows.length > 0) {
        const rows = plan.rows.map((r) => {
          const { id: _id, created_at: _c, ...rest } = r;
          return { ...rest, company_id: profile.companyId };
        });
        const ledgerSave = await supabase.from("xero_stock_sales").upsert(rows, { onConflict: "company_id,xero_line_id" });
        if (ledgerSave.error) {
          console.error(ledgerSave.error);
          if (!quiet) showToast("error", "Something didn't save — check your connection and try again.");
          return;
        }
      }
      if (plan.batchChanges.length > 0) {
        const ok = await updateXeroSold(plan.batchChanges);
        if (!ok && !quiet) showToast("error", "Some stock didn't update — check your connection and try again.");
        const byId = Object.fromEntries(plan.batchChanges.map((c) => [c.id, c.xeroSold]));
        setBatches((prev) => prev.map((b) => (byId[b.id] ? { ...b, xeroSold: byId[b.id] } : b)));
      }
      const unmatchedLedger = (ledgerRes.data || []).filter((r) => r.status === "unmapped" && !plan.rows.some((x) => x.xero_line_id === r.xero_line_id)).map((r) => r.item_code);
      setXeroUnmatched([...new Set([...Object.keys(plan.unmatched), ...unmatchedLedger])].filter(Boolean));
      const now = new Date().toISOString();
      await supabase.from("xero_settings").update({ last_sales_sync: now }).eq("company_id", profile.companyId);
      setXeroSettings((prev) => ({ ...(prev || {}), last_sales_sync: now }));
      const { summary } = plan;
      if (summary.applied > 0 || summary.reversed > 0) {
        logActivity("synced", "stock", "Xero sales", `Took ${Math.round(summary.units)} units off for ${summary.applied} Xero sale line${summary.applied === 1 ? "" : "s"}${summary.reversed ? `, gave back ${summary.reversed} voided` : ""}`);
      }
      if (!quiet || summary.applied > 0 || summary.reversed > 0) {
        const parts = [];
        if (summary.applied > 0) parts.push(`${Math.round(summary.units).toLocaleString("en-NZ")} units taken off for ${summary.applied} Xero sale line${summary.applied === 1 ? "" : "s"}`);
        if (summary.reversed > 0) parts.push(`${summary.reversed} voided line${summary.reversed === 1 ? "" : "s"} put back`);
        if (summary.short > 0) parts.push(`${summary.short} sold more than Brewpoint had on hand`);
        if (summary.unmapped > 0) parts.push(`${summary.unmapped} line${summary.unmapped === 1 ? "" : "s"} for items not matched yet`);
        showToast(summary.short > 0 || summary.unmapped > 0 ? "error" : "success", parts.length ? `Xero sales: ${parts.join(" · ")}.` : "Xero sales checked — nothing new.");
      }
    } catch (err) {
      console.error(err);
      if (!quiet) showToast("error", "Couldn't read sales from Xero just now — try again in a minute.");
    } finally {
      xeroSalesSyncRunning.current = false;
      setXeroSalesSyncing(false);
    }
  };

  // Check Xero when the app opens and every 10 minutes while it's open.
  const syncSalesRef = useRef(syncSalesFromXero);
  syncSalesRef.current = syncSalesFromXero;
  const salesSyncOn = !loadingData && !!xeroConnection && !!xeroSettings?.sales_sync_enabled;
  useEffect(() => {
    if (!salesSyncOn) return undefined;
    const first = setTimeout(() => syncSalesRef.current(true), 3000);
    const every = setInterval(() => syncSalesRef.current(true), 10 * 60 * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [salesSyncOn]);

  const setXeroSalesSync = async (enabled) => {
    const patch = enabled ? { sales_sync_enabled: true, sales_sync_from: xeroSettings?.sales_sync_from || today() } : { sales_sync_enabled: false };
    const { error } = await supabase.from("xero_settings").upsert({ ...(xeroSettings || {}), company_id: profile.companyId, ...patch });
    if (error) { console.error(error); showToast("error", "Something didn't save — check your connection and try again."); return; }
    setXeroSettings((prev) => ({ ...(prev || {}), company_id: profile.companyId, ...patch }));
    showToast("success", enabled ? "Xero sales will now take stock off Brewpoint." : "Stopped reading sales from Xero.");
  };

  const openXeroItemMatch = async () => {
    const data = await callXeroApi("listAllItems");
    if (data.error) { showToast("error", "Couldn't load your Xero items — try again in a minute."); return; }
    setXeroMatchItems(data.items || []);
  };

  const saveXeroSalesMap = async (records) => {
    const rows = records.map((r) => ({ ...r, company_id: profile.companyId }));
    const { data, error } = await supabase.from("xero_sales_item_map").upsert(rows, { onConflict: "company_id,xero_item_code" }).select();
    if (error) { console.error(error); showToast("error", "Something didn't save — check your connection and try again."); return false; }
    setXeroSalesMap((prev) => {
      const byCode = Object.fromEntries(prev.map((m) => [String(m.xero_item_code).toLowerCase(), m]));
      (data || []).forEach((m) => (byCode[String(m.xero_item_code).toLowerCase()] = m));
      return Object.values(byCode);
    });
    const savedCodes = new Set(records.map((r) => String(r.xero_item_code).toLowerCase()));
    setXeroUnmatched((prev) => prev.filter((c) => !savedCodes.has(String(c).toLowerCase())));
    showToast("success", `Saved ${records.length} Xero item match${records.length === 1 ? "" : "es"}.`);
    return true;
  };

  const openXeroStockCompare = async () => {
    const data = await callXeroApi("listAllItems");
    if (data.error) { showToast("error", "Couldn't load stock from Xero — try again in a minute."); return; }
    setXeroCompareItems(data.items || []);
  };

  const matchStockToXero = async (rows) => {
    const { offPerBatch, backPerBatch } = planXeroStockMatch({ rows, availableStock, batches });
    const when = new Date().toISOString();
    const who = user?.name || "Someone";
    const offId = uid();
    const backId = uid();
    const ids = new Set([...Object.keys(offPerBatch), ...Object.keys(backPerBatch)]);
    const changes = [...ids].map((id) => {
      const b = batches.find((x) => x.id === id);
      const list = [...(b?.stockCleared || [])];
      if (offPerBatch[id]) list.push({ id: offId, kind: "xero-match", date: when, user: who, reason: "Brewpoint had more than Xero — written off to match Xero", counts: offPerBatch[id] });
      if (backPerBatch[id]) {
        const neg = Object.fromEntries(Object.entries(backPerBatch[id]).map(([k, v]) => [k, -v]));
        list.push({ id: backId, kind: "xero-match", date: when, user: who, reason: "Xero had more than Brewpoint — put back to match Xero", counts: neg });
      }
      return { id, stockCleared: list };
    });
    const done = await updateStockCleared(changes);
    const doneIds = new Set(changes.slice(0, done).map((c) => c.id));
    setBatches((prev) => prev.map((b) => (doneIds.has(b.id) ? { ...b, stockCleared: changes.find((c) => c.id === b.id).stockCleared } : b)));
    if (done < changes.length) {
      showToast("error", `Only part of the stock was updated (${done} of ${changes.length} batches) — check your connection and try again.`);
      return false;
    }
    logActivity("synced", "stock", "Packaged stock", `Matched ${rows.length} product${rows.length === 1 ? "" : "s"} to Xero's stock on hand`);
    showToast("success", `Brewpoint now matches Xero for ${rows.length} product${rows.length === 1 ? "" : "s"}.`);
    return true;
  };

  // Finished stock isn't a single stored number the way ingredients or
  // consumables are — it's worked out from packaging events minus sales
  // orders. So a stock take here can't "correct" a field the way the
  // others do; it's a discrepancy report for the record, same as walking
  // any other shelf and writing down what's actually there.
  const completeFinishedStockTake = async (lines) => {
    const date = today();
    const record = { id: uid(), date, userName: user.name, lines, type: "finished_stock" };
    const { data, error } = await supabase
      .from("stock_takes")
      .insert(stockTakeToRow(record, user.id, profile.companyId))
      .select()
      .single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setStockTakes((prev) => [rowToStockTake(data), ...prev]);
    showToast("success", "Stock take saved.");
  };

  // The item number Customs needs on an actual excise entry, per product
  // type — entered once by the business (ideally confirmed with their
  // accountant), never guessed or pre-filled by the app itself.
  const saveExciseItemCode = async (productType, itemNumber) => {
    const existing = exciseItemCodes.find((e) => e.productType === productType);
    const record = { id: existing?.id, productType, itemNumber };
    const row = exciseItemCodeToRow(record, profile.companyId);
    if (!existing) delete row.id; // let Postgres generate the real UUID — uid() is only a short client-side key
    const { data, error } = await supabase.from("excise_item_codes").upsert(row, { onConflict: "company_id,product_type" }).select().single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    const saved = rowToExciseItemCode(data);
    setExciseItemCodes((prev) => (existing ? prev.map((e) => (e.id === saved.id ? saved : e)) : [...prev, saved]));
  };

  const addPestStation = async (station) => {
    const row = pestStationToRow(station, profile.companyId);
    delete row.id; // let Postgres generate the real UUID, same fix as customers/sales_orders
    const { data, error } = await supabase.from("pest_stations").insert(row).select().single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setPestStations((prev) => [...prev, rowToPestStation(data)].sort((a, b) => a.label.localeCompare(b.label)));
    showToast("success", `${station.label} added.`);
  };

  const updatePestStation = async (id, patch) => {
    const row = {};
    if ("active" in patch) row.active = patch.active;
    if ("label" in patch) row.label = patch.label;
    if ("location" in patch) row.location = patch.location;
    const { error } = await supabase.from("pest_stations").update(row).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setPestStations((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  // Registers a batch of physical kegs at once — e.g. numbering 50 kegs
  // in one go rather than adding them one at a time.
  const addKegsBulk = async (lines) => {
    let successCount = 0;
    const newKegs = [];
    for (const line of lines) {
      const row = kegToRow({ kegNumber: line.kegNumber, sizeL: line.sizeL, status: "In brewery", history: [] }, profile.companyId);
      delete row.id;
      const { data, error } = await supabase.from("kegs").insert(row).select().single();
      if (error) { showToast("error", `Couldn't add keg ${line.kegNumber} — it may already exist.`); continue; }
      newKegs.push(rowToKeg(data));
      successCount++;
    }
    setKegs((prev) => [...prev, ...newKegs].sort((a, b) => a.kegNumber.localeCompare(b.kegNumber, undefined, { numeric: true })));
    showToast("success", `${successCount} keg${successCount !== 1 ? "s" : ""} added.`);
  };

  const fillKeg = async (kegId, batchId, batchName, date) => {
    const keg = kegs.find((k) => k.id === kegId);
    if (!keg) return;
    const historyEntry = { id: uid(), date: stampForDate(date), user: user.name, type: "filled", note: `Filled with ${batchName}` };
    const newHistory = [...(keg.history || []), historyEntry];
    const { error } = await supabase.from("kegs").update({ current_batch_id: batchId, current_batch_name: batchName, history: newHistory }).eq("id", kegId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setKegs((prev) => prev.map((k) => (k.id === kegId ? { ...k, currentBatchId: batchId, currentBatchName: batchName, history: newHistory } : k)));
  };

  const sendKeg = async (kegId, customerId, customerName, dueBackDate, date) => {
    const keg = kegs.find((k) => k.id === kegId);
    if (!keg) return;
    const sentDate = date || today();
    const historyEntry = { id: uid(), date: stampForDate(date), user: user.name, type: "sent", note: `Sent to ${customerName}${keg.currentBatchName ? ` — ${keg.currentBatchName}` : ""}` };
    const newHistory = [...(keg.history || []), historyEntry];
    const payload = { status: "With customer", current_customer_id: customerId, current_customer_name: customerName, sent_date: sentDate, due_back_date: dueBackDate || null, history: newHistory };
    const { error } = await supabase.from("kegs").update(payload).eq("id", kegId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setKegs((prev) =>
      prev.map((k) =>
        k.id === kegId
          ? { ...k, status: "With customer", currentCustomerId: customerId, currentCustomerName: customerName, sentDate, dueBackDate: dueBackDate || null, history: newHistory }
          : k
      )
    );
    showToast("success", `Keg ${keg.kegNumber} sent to ${customerName}.`);
  };

  const returnKeg = async (kegId, date) => {
    const keg = kegs.find((k) => k.id === kegId);
    if (!keg) return;
    const historyEntry = { id: uid(), date: stampForDate(date), user: user.name, type: "returned", note: `Returned from ${keg.currentCustomerName || "customer"}` };
    const newHistory = [...(keg.history || []), historyEntry];
    const payload = { status: "In brewery", current_customer_id: null, current_customer_name: null, current_batch_id: null, current_batch_name: null, sent_date: null, due_back_date: null, history: newHistory };
    const { error } = await supabase.from("kegs").update(payload).eq("id", kegId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setKegs((prev) =>
      prev.map((k) =>
        k.id === kegId
          ? { ...k, status: "In brewery", currentCustomerId: null, currentCustomerName: null, currentBatchId: null, currentBatchName: null, sentDate: null, dueBackDate: null, history: newHistory }
          : k
      )
    );
    showToast("success", `Keg ${keg.kegNumber} marked returned.`);
  };

  const markKegLost = async (kegId) => {
    const keg = kegs.find((k) => k.id === kegId);
    if (!keg) return;
    const historyEntry = { id: uid(), date: new Date().toISOString(), user: user.name, type: "lost", note: `Marked lost${keg.currentCustomerName ? ` — was with ${keg.currentCustomerName}` : ""}` };
    const newHistory = [...(keg.history || []), historyEntry];
    const { error } = await supabase.from("kegs").update({ status: "Lost", history: newHistory }).eq("id", kegId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setKegs((prev) => prev.map((k) => (k.id === kegId ? { ...k, status: "Lost", history: newHistory } : k)));
  };

  const deleteKeg = async (kegId) => {
    const { error } = await supabase.from("kegs").delete().eq("id", kegId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setKegs((prev) => prev.filter((k) => k.id !== kegId));
  };

  const addFoodSafetyRecord = async (record) => {
    const payload = { id: uid(), userName: user.name, ...record };
    const { data, error } = await supabase
      .from("food_safety_records")
      .insert(foodSafetyRecordToRow(payload, user.id, profile.companyId))
      .select()
      .single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setFoodSafetyRecords((prev) => [rowToFoodSafetyRecord(data), ...prev]);
    showToast("success", "Logged.");
  };

  const resolveCorrectiveAction = async (recordId) => {
    const { error } = await supabase.from("food_safety_records").update({ corrective_action_resolved: true }).eq("id", recordId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setFoodSafetyRecords((prev) => prev.map((r) => (r.id === recordId ? { ...r, correctiveActionResolved: true } : r)));
    showToast("success", "Marked resolved.");
  };

  const addSupplier = async (supplier) => {
    const payload = { id: uid(), ...supplier };
    const { data, error } = await supabase
      .from("suppliers")
      .insert(supplierToRow(payload, profile.companyId))
      .select()
      .single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setSuppliers((prev) => [...prev, rowToSupplier(data)].sort((a, b) => a.name.localeCompare(b.name)));
    showToast("success", `${payload.name} added.`);
  };

  const updateSupplier = async (id, patch) => {
    const supplier = suppliers.find((s) => s.id === id);
    if (!supplier) return;
    const updated = { ...supplier, ...patch };
    const { error } = await supabase
      .from("suppliers")
      .update(supplierToRow(updated, profile.companyId))
      .eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setSuppliers((prev) => prev.map((s) => (s.id === id ? updated : s)).sort((a, b) => a.name.localeCompare(b.name)));
  };

  const deleteSupplier = async (id) => {
    const supplier = suppliers.find((s) => s.id === id);
    if (!supplier) return;
    const relatedDocs = supplierDocuments.filter((d) => d.supplierId === id);
    setSuppliers((prev) => prev.filter((s) => s.id !== id));
    setSupplierDocuments((prev) => prev.filter((d) => d.supplierId !== id));
    const timeoutId = setTimeout(async () => {
      delete pendingDeletesRef.current[id];
      const { error } = await supabase.from("suppliers").delete().eq("id", id);
      if (error) showToast("error", "Something didn't save — check your connection and try again.");
    }, 5000);
    pendingDeletesRef.current[id] = timeoutId;
    showToast("success", `${supplier.name} deleted.`, {
      label: "Undo",
      onClick: () => {
        clearTimeout(pendingDeletesRef.current[id]);
        delete pendingDeletesRef.current[id];
        setSuppliers((prev) => [...prev, supplier].sort((a, b) => a.name.localeCompare(b.name)));
        setSupplierDocuments((prev) => [...prev, ...relatedDocs]);
      },
    });
  };

  const addCustomer = async (customer) => {
    const row = customerToRow(customer, profile.companyId);
    delete row.id; // uid() makes a short client-side key, not a real UUID — let Postgres generate the real one
    const { data, error } = await supabase
      .from("customers")
      .insert(row)
      .select()
      .single();
    if (error) { showToast("error", `Save failed: ${error.message || error.code || "unknown error"}`); return; }
    setCustomers((prev) => [...prev, rowToCustomer(data)].sort((a, b) => a.name.localeCompare(b.name)));
    showToast("success", `${customer.name} added.`);
  };

  const updateCustomer = async (id, patch) => {
    const customer = customers.find((c) => c.id === id);
    if (!customer) return;
    const updated = { ...customer, ...patch };
    const { error } = await supabase
      .from("customers")
      .update(customerToRow(updated, profile.companyId))
      .eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setCustomers((prev) => prev.map((c) => (c.id === id ? updated : c)).sort((a, b) => a.name.localeCompare(b.name)));
  };

  const deleteCustomer = (customer) => {
    askConfirm(
      `Delete ${customer.name}? You'll have a few seconds to undo right after.`,
      () => {
        setCustomers((prev) => prev.filter((c) => c.id !== customer.id));
        setSelectedCustomerId(null);
        const timeoutId = setTimeout(async () => {
          delete pendingDeletesRef.current[customer.id];
          const { error } = await supabase.from("customers").delete().eq("id", customer.id);
          if (error) showToast("error", "Something didn't save — check your connection and try again.");
        }, 5000);
        pendingDeletesRef.current[customer.id] = timeoutId;
        showToast("success", `${customer.name} deleted.`, {
          label: "Undo",
          onClick: () => {
            clearTimeout(pendingDeletesRef.current[customer.id]);
            delete pendingDeletesRef.current[customer.id];
            setCustomers((prev) => [...prev, customer].sort((a, b) => a.name.localeCompare(b.name)));
          },
        });
      },
      { confirmLabel: "Delete", destructive: true }
    );
  };

  const addSalesOrder = async (order) => {
    const row = salesOrderToRow(order, profile.companyId);
    delete row.id; // same fix as addCustomer — let Postgres generate the real UUID
    const { data, error } = await supabase
      .from("sales_orders")
      .insert(row)
      .select()
      .single();
    if (error) { showToast("error", `Save failed: ${error.message || error.code || "unknown error"}`); return; }
    setSalesOrders((prev) => [rowToSalesOrder(data), ...prev]);
    showToast("success", `${order.orderNumber} created.`);
    logActivity("created", "sales order", order.orderNumber, `Sales order ${order.orderNumber} created`);
  };

  // Fires once an order is marked Fulfilled — reuses the same item mappings
  // already built up from packaging sync, and either matches or creates a
  // Xero contact for the customer server-side. If Xero isn't connected,
  // this just quietly does nothing, same as the packaging sync does.
  const syncOrderToXero = async (order) => {
    if (!xeroConnection) return;
    const customer = customers.find((c) => c.id === order.customerId);
    if (!customer) return;
    const lineItems = (order.lines || []).map((l) => {
      if (l.mixedPackTypeId) {
        return { description: l.mixedPackTypeName, quantity: l.qty, unitAmount: l.unitPrice, itemCode: null };
      }
      const mapping = xeroItemMappings.find((m) => m.product_key === productKeyFor(l.batchName, l.containerKey));
      return {
        description: `${l.batchName} — ${l.containerLabel}`,
        quantity: l.qty,
        unitAmount: l.unitPrice,
        itemCode: mapping ? mapping.xero_item_code : null,
      };
    });
    const result = await callXeroApi("createInvoice", {
      contactId: customer.xeroContactId || null,
      customerName: customer.name,
      customerEmail: customer.email || null,
      reference: order.orderNumber,
      lineItems,
    });
    if (result.error) {
      console.error("Xero invoice sync failed:", result.error, result.detail);
      showToast("error", "Order fulfilled, but the Xero invoice couldn't be created — check your Xero connection.");
    } else {
      showToast("success", "Invoice sent to Xero.");
    }
  };

  const advanceSalesOrderStatus = async (id, status) => {
    const { error } = await supabase.from("sales_orders").update({ status }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setSalesOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    showToast("success", `Order ${status.toLowerCase()}.`);
  };

  // Records however much of each line is genuinely shipping right now —
  // never all-or-nothing. Whatever's left on a line stays open as a real,
  // tracked backorder rather than blocking the whole order. Only the
  // portion fulfilled in this pass gets synced to Xero, as its own
  // partial invoice, not the full order total.
  const recordFulfillment = async (orderId, fulfillingNowLines, pod, date) => {
    const order = salesOrders.find((o) => o.id === orderId);
    if (!order) return;

    const fulfillMap = {};
    fulfillingNowLines.forEach((l) => (fulfillMap[l.id] = l.fulfillNow));

    const newLines = (order.lines || []).map((l) => ({
      ...l,
      fulfilledQty: (l.fulfilledQty || 0) + (fulfillMap[l.id] || 0),
    }));
    const allFulfilled = newLines.every((l) => (l.fulfilledQty || 0) >= l.qty);
    const newStatus = allFulfilled ? "Fulfilled" : "Partially fulfilled";
    const proofsOfDelivery = pod ? [...(order.proofsOfDelivery || []), { id: uid(), ...pod }] : order.proofsOfDelivery || [];

    const { error } = await supabase.from("sales_orders").update({ lines: newLines, status: newStatus, proofs_of_delivery: proofsOfDelivery }).eq("id", orderId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setSalesOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, lines: newLines, status: newStatus, proofsOfDelivery } : o)));
    showToast("success", allFulfilled ? "Order fully fulfilled." : "Partial fulfillment recorded — the rest stays open.");

    const partialOrderForXero = { ...order, orderDate: date || order.orderDate, lines: fulfillingNowLines.map((l) => ({ ...l, qty: l.fulfillNow })) };
    syncOrderToXero(partialOrderForXero);
  };

  const cancelSalesOrder = (id) => {
    askConfirm(
      "Cancel this order? Any stock it had reserved will become available to sell again.",
      async () => {
        const { error } = await supabase.from("sales_orders").update({ status: "Cancelled" }).eq("id", id);
        if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
        setSalesOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: "Cancelled" } : o)));
        showToast("success", "Order cancelled.");
      },
      { confirmLabel: "Cancel order", destructive: true }
    );
  };

  const toggleSalesOrderPaid = async (id, paid) => {
    const { error } = await supabase.from("sales_orders").update({ paid }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setSalesOrders((prev) => prev.map((o) => (o.id === id ? { ...o, paid } : o)));
  };

  const deleteSalesOrder = (order) => {
    askConfirm(
      `Delete ${order.orderNumber}? This can't be undone.`,
      async () => {
        const { error } = await supabase.from("sales_orders").delete().eq("id", order.id);
        if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
        setSalesOrders((prev) => prev.filter((o) => o.id !== order.id));
        setSelectedSalesOrderId(null);
        showToast("success", `${order.orderNumber} deleted.`);
      },
      { confirmLabel: "Delete", destructive: true }
    );
  };

  const uploadSupplierDocument = async (supplierId, file, name, expiryDate) => {
    const filePath = `${profile.companyId}/${supplierId}/${uid()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("supplier-documents").upload(filePath, file);
    if (uploadError) {
      console.error(uploadError);
      return { error: uploadError.message };
    }
    const payload = {
      id: uid(),
      supplierId,
      name: name || file.name,
      filePath,
      fileType: file.type,
      expiryDate: expiryDate || null,
      uploadedBy: user.name,
    };
    const { data, error } = await supabase
      .from("supplier_documents")
      .insert(supplierDocumentToRow(payload, profile.companyId))
      .select()
      .single();
    if (error) {
      console.error(error);
      return { error: error.message };
    }
    setSupplierDocuments((prev) => [rowToSupplierDocument(data), ...prev]);
    showToast("success", "Document uploaded.");
    return { success: true };
  };

  const deleteSupplierDocument = async (doc) => {
    await supabase.storage.from("supplier-documents").remove([doc.filePath]);
    const { error } = await supabase.from("supplier_documents").delete().eq("id", doc.id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setSupplierDocuments((prev) => prev.filter((d) => d.id !== doc.id));
  };

  const openSupplierDocument = async (doc) => {
    const { data, error } = await supabase.storage.from("supplier-documents").createSignedUrl(doc.filePath, 60);
    if (error) {
      showToast("error", "Something didn't save — check your connection and try again.");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const addTank = async (t) => {
    const { data, error } = await supabase.from("tanks").insert(tankToRow(t, profile.companyId)).select().single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setTanks((prev) => [rowToTank(data), ...prev]);
    showToast("success", `${t.name} added.`);
    logActivity("added", "tank", t.name, `Tank ${t.name} added`);
  };

  const updateTank = async (id, patch) => {
    const { error } = await supabase.from("tanks").update({ name: patch.name, capacity: patch.capacity, type: patch.type, barrel_source: patch.barrelSource ?? null }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setTanks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  // Cycles a tank through the CIP workflow — tapping the badge on an empty
  // tank moves it to the next step. Sanitised loops back to Needs CIP if
  // tapped again, in case that was a mistake.
  const cycleTankClean = async (id) => {
    const tank = tanks.find((t) => t.id === id);
    if (!tank) return;
    const next = NEXT_CLEAN_STAGE[tank.cleanStatus || "Needs CIP"] || "Needs CIP";
    const history = [...(tank.history || []), { id: uid(), type: "clean", date: new Date().toISOString(), stage: next }];
    const { error } = await supabase.from("tanks").update({ clean_status: next, history }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setTanks((prev) => prev.map((t) => (t.id === id ? { ...t, cleanStatus: next, history } : t)));
  };

  // For Brite tanks choosing between acid and caustic clean — sets the
  // stage directly rather than just advancing to "next."
  const setTankCleanStage = async (id, stage) => {
    const tank = tanks.find((t) => t.id === id);
    if (!tank) return;
    const history = [...(tank.history || []), { id: uid(), type: "clean", date: new Date().toISOString(), stage }];
    const { error } = await supabase.from("tanks").update({ clean_status: stage, history }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setTanks((prev) => prev.map((t) => (t.id === id ? { ...t, cleanStatus: stage, history } : t)));
  };

  // Whenever a tank starts being used by a batch, its clean status resets —
  // so the next time it empties out, it correctly starts a fresh CIP cycle
  // instead of showing a stale "Sanitised" from before. Also logs a batch
  // history entry — this is what lets the tank's history view show every
  // batch that's ever used it.
  const resetTankClean = async (tankId, batch) => {
    if (!tankId) return;
    const tank = tanks.find((t) => t.id === tankId);
    const historyEntry = batch
      ? [{ id: uid(), type: "batch", date: new Date().toISOString(), batchId: batch.id, batchName: batch.name, batchNumber: batch.number }]
      : [];
    const history = [...(tank?.history || []), ...historyEntry];
    await supabase.from("tanks").update({ clean_status: null, history }).eq("id", tankId);
    setTanks((prev) => prev.map((t) => (t.id === tankId ? { ...t, cleanStatus: null, history } : t)));
  };

  const deleteTank = async (id) => {
    const tank = tanks.find((t) => t.id === id);
    if (!tank) return;
    setTanks((prev) => prev.filter((t) => t.id !== id));
    logActivity("deleted", "tank", tank.name, `Tank ${tank.name} deleted`);
    const timeoutId = setTimeout(async () => {
      delete pendingDeletesRef.current[id];
      const { error } = await supabase.from("tanks").delete().eq("id", id);
      if (error) showToast("error", "Something didn't save — check your connection and try again.");
    }, 5000);
    pendingDeletesRef.current[id] = timeoutId;
    showToast("success", `${tank.name} deleted.`, {
      label: "Undo",
      onClick: () => {
        clearTimeout(pendingDeletesRef.current[id]);
        delete pendingDeletesRef.current[id];
        setTanks((prev) => [tank, ...prev]);
      },
    });
  };

  const assignBatchTank = async (batchId, tank, brewStage) => {
    const batch = batches.find((b) => b.id === batchId);
    const { error } = await supabase
      .from("batches")
      .update({ tank_id: tank ? tank.id : null, tank_name: tank ? tank.name : null, brew_stage: brewStage ?? null })
      .eq("id", batchId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) =>
      prev.map((b) => (b.id === batchId ? { ...b, tankId: tank ? tank.id : null, tankName: tank ? tank.name : null, brewStage: brewStage ?? null } : b))
    );
    if (tank) resetTankClean(tank.id, batch);
  };

  // Splitting a batch that's already fermenting into multiple tanks — same
  // reasoning as the kettle-stage split in transferToFermenter: from this
  // point on each tank needs to be its own real, independent batch, not a
  // shared record. The difference here is this batch may already be days
  // into fermentation, so everything accumulated so far (readings, notes,
  // faults, diacetyl tests) needs to carry forward to every sibling, not
  // just the original brew-day data.
  const splitBatchIntoTanks = async (batchId, tanksChosen) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;

    if (tanksChosen.length === 1) {
      const tank = tanksChosen[0];
      const target = tanks.find((t) => t.id === tank.tankId);
      const patch = { tank_id: tank.tankId, tank_name: tank.tankName };
      const { error } = await supabase.from("batches").update(patch).eq("id", batchId);
      if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
      setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, tankId: tank.tankId, tankName: tank.tankName } : b)));
      if (target) resetTankClean(target.id, batch);
      return;
    }

    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const totalSplitVolume = tanksChosen.reduce((sum, t) => sum + (Number(t.volume) || 0), 0);
    // Always a fresh id for this specific split — if the source batch was
    // itself already a sibling of an earlier split, it would already carry
    // its own splitGroupId, and blindly reusing that would incorrectly
    // merge two unrelated brew days into one group.
    const splitGroupId = uid();
    const newBatches = tanksChosen.map((t, i) => {
      const suffix = letters[i] || String(i + 1);
      const share = totalSplitVolume > 0 ? t.volume / totalSplitVolume : 0;
      return {
        ...batch,
        id: uid(),
        number: `${batch.number}${suffix}`,
        name: `${batch.name} — ${suffix}`,
        volume: t.volume,
        tankId: t.tankId,
        tankName: t.tankName,
        splitTanks: [],
        splitGroupId,
        ingredientCost: batch.ingredientCost != null ? Math.round(batch.ingredientCost * share * 100) / 100 : null,
      };
    });

    for (const nb of newBatches) {
      const { error } = await supabase.from("batches").insert(batchToRow(nb, user.id, profile.companyId));
      if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    }
    const { error: deleteError } = await supabase.from("batches").delete().eq("id", batchId);
    if (deleteError) { showToast("error", "Something didn't save — check your connection and try again."); return; }

    setBatches((prev) => [...newBatches, ...prev.filter((b) => b.id !== batchId)]);
    setSelectedId(newBatches[0].id);
    const summary = newBatches.map((b) => `${b.name} (${b.tankName})`).join(" + ");
    showToast("success", `Split into ${newBatches.length} separate batches.`);
    logActivity("advanced", "batch", batch.name, `${batch.name} (#${batch.number}) split into ${summary}`);
    tanksChosen.forEach((t, i) => resetTankClean(t.tankId, newBatches[i]));
  };

  // One-time conversion for a batch still in the old shape — a single
  // record with a splitTanks list — into the new shape: genuinely
  // separate batches, one per tank, linked by splitGroupId. Unlike a
  // fresh split, each side here may already have its own readings,
  // notes, faults, and additions logged against it from before this
  // fix existed — those get merged in, not discarded, so nothing from
  // that history is lost in the conversion.
  const convertSplitTanksToBatches = async (batchId) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch || !batch.splitTanks || batch.splitTanks.length === 0) return;

    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const totalSplitVolume = batch.splitTanks.reduce((sum, t) => sum + (Number(t.volume) || 0), 0);
    const splitGroupId = uid();
    const newBatches = batch.splitTanks.map((t, i) => {
      const suffix = letters[i] || String(i + 1);
      const share = totalSplitVolume > 0 ? t.volume / totalSplitVolume : 0;
      return {
        ...batch,
        id: uid(),
        number: `${batch.number}${suffix}`,
        name: `${batch.name} — ${suffix}`,
        volume: t.volume,
        tankId: t.tankId,
        tankName: t.tankName,
        splitTanks: [],
        splitGroupId,
        readings: [...(batch.readings || []), ...(t.readings || [])],
        notes: [...(batch.notes || []), ...(t.notes || [])],
        faults: [...(batch.faults || []), ...(t.faults || [])],
        batchAdditions: [...(batch.batchAdditions || []), ...(t.additions || [])],
        ingredientCost: batch.ingredientCost != null ? Math.round(batch.ingredientCost * share * 100) / 100 : null,
      };
    });

    for (const nb of newBatches) {
      const { error } = await supabase.from("batches").insert(batchToRow(nb, user.id, profile.companyId));
      if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    }
    const { error: deleteError } = await supabase.from("batches").delete().eq("id", batchId);
    if (deleteError) { showToast("error", "Something didn't save — check your connection and try again."); return; }

    setBatches((prev) => [...newBatches, ...prev.filter((b) => b.id !== batchId)]);
    setSelectedId(newBatches[0].id);
    const summary2 = newBatches.map((b) => `${b.name} (${b.tankName})`).join(" + ");
    showToast("success", `Converted into ${newBatches.length} separate batches.`);
    logActivity("advanced", "batch", batch.name, `${batch.name} (#${batch.number}) converted into ${summary2}`);
  };

  // Logs a hop, fruit, or other addition made to just one side of a split
  // batch — and deducts real stock the same way the original recipe
  // ingredients do, so a dry hop mid-fermentation is still accounted for.
  const addSplitTankIngredient = async (batchId, tankId, entry) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;
    const additionEntry = { id: uid(), name: entry.name, qty: entry.qty, unit: entry.unit, note: entry.note || null, date: entry.date || today() };
    const newSplitTanks = batch.splitTanks.map((t) =>
      t.tankId === tankId ? { ...t, additions: [...(t.additions || []), additionEntry] } : t
    );
    const { error } = await supabase.from("batches").update({ split_tanks: newSplitTanks }).eq("id", batchId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, splitTanks: newSplitTanks } : b)));

    const item = inventory.find((it) => sameItemName(it.name, entry.name));
    if (item) {
      const { updatedLots } = deductFromLotsFIFO(item.lots, entry.qty);
      const newQty = Math.max(0, Math.round((item.qty - entry.qty) * 100) / 100);
      const historyEntry = { id: uid(), date: stampForDate(entry.date), user: user.name, type: "batch", delta: -entry.qty, note: `${batch.name} (#${batch.number}) — split addition` };
      const newHistory = [...(item.history || []), historyEntry];
      const { error: invError } = await supabase.from("inventory_items").update({ qty: newQty, lots: updatedLots, history: newHistory }).eq("id", item.id);
      if (!invError) setInventory((prev) => prev.map((it) => (it.id === item.id ? { ...it, qty: newQty, lots: updatedLots, history: newHistory } : it)));
    }
    showToast("success", `${entry.name} added.`);
  };

  // Same idea as a split-tank addition, but for the far more common case:
  // an individual batch (even one that started life as "half" of a brew,
  // tracked as its own separate record) getting a hop or fruit addition
  // mid-fermentation.
  // Saves cider fields (juice intake, blends, back-sweetening) or the
  // batch's OG/FG/volume from the Cider page.
  const CIDER_COLUMNS = { juiceIntake: "juice_intake", blendLog: "blend_log", backSweetenings: "back_sweetenings", og: "og", fg: "fg", volume: "volume" };
  const saveCiderData = async (batchId, patch) => {
    const row = {};
    Object.entries(patch).forEach(([k, v]) => { if (CIDER_COLUMNS[k]) row[CIDER_COLUMNS[k]] = v; });
    const { error } = await supabase.from("batches").update(row).eq("id", batchId);
    if (error) { console.error(error); showToast("error", "Something didn't save — check your connection and try again."); return false; }
    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, ...patch } : b)));
    if (patch.og != null) showToast("success", "Batch OG, FG and volume updated.");
    return true;
  };

  const addBatchIngredient = async (batchId, entry) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;
    const additionEntry = { id: uid(), name: entry.name, qty: entry.qty, unit: entry.unit, note: entry.note || null, date: entry.date || today() };
    const newAdditions = [...(batch.batchAdditions || []), additionEntry];
    const { error } = await supabase.from("batches").update({ batch_additions: newAdditions }).eq("id", batchId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, batchAdditions: newAdditions } : b)));

    const item = inventory.find((it) => sameItemName(it.name, entry.name));
    if (item) {
      const { updatedLots } = deductFromLotsFIFO(item.lots, entry.qty);
      const newQty = Math.max(0, Math.round((item.qty - entry.qty) * 100) / 100);
      const historyEntry = { id: uid(), date: stampForDate(entry.date), user: user.name, type: "batch", delta: -entry.qty, note: `${batch.name} (#${batch.number}) — addition` };
      const newHistory = [...(item.history || []), historyEntry];
      const { error: invError } = await supabase.from("inventory_items").update({ qty: newQty, lots: updatedLots, history: newHistory }).eq("id", item.id);
      if (!invError) setInventory((prev) => prev.map((it) => (it.id === item.id ? { ...it, qty: newQty, lots: updatedLots, history: newHistory } : it)));
    }
    showToast("success", `${entry.name} added.`);
  };

  // A second (or third...) brew day filling the same tank — deducts real
  // stock for each ingredient the same way the original brew day did,
  // adds to the batch's running volume and ingredient list, and keeps a
  // dated log of each pass so the blending history stays visible.
  // Folds a second, genuinely separate batch's numbers into the target
  // batch as a brew day — for when a second mash/boil was tracked as its
  // own full batch (live readings, its own mash pH, etc.) rather than
  // typed in after the fact. Never touches inventory: the source batch
  // already deducted its own ingredients when it was created, so doing
  // it again here would double-count them. The source batch is marked
  // merged, not deleted, so its own history stays intact if it's ever
  // worth looking back at.
  const mergeBatchAsBrewDay = async (targetBatchId, sourceBatchId) => {
    const targetBatch = batches.find((b) => b.id === targetBatchId);
    const sourceBatch = batches.find((b) => b.id === sourceBatchId);
    if (!targetBatch || !sourceBatch) return;

    const brewDayEntry = {
      id: uid(),
      date: sourceBatch.startDate,
      volume: sourceBatch.volume,
      og: sourceBatch.og,
      ingredients: sourceBatch.ingredients,
      fromBatchId: sourceBatch.id,
      fromBatchName: sourceBatch.name,
    };
    const newBrewDays = [...(targetBatch.brewDays || []), brewDayEntry];
    const newVolume = Math.round((targetBatch.volume + sourceBatch.volume) * 100) / 100;
    const newIngredients = [...targetBatch.ingredients, ...sourceBatch.ingredients.map((i) => ({ ...i, id: uid() }))];
    const newIngredientCost = Math.round(((targetBatch.ingredientCost || 0) + (sourceBatch.ingredientCost || 0)) * 100) / 100;

    const { error: targetError } = await supabase
      .from("batches")
      .update({ brew_days: newBrewDays, volume: newVolume, ingredients: newIngredients, ingredient_cost: newIngredientCost })
      .eq("id", targetBatchId);
    if (targetError) { showToast("error", "Something didn't save — check your connection and try again."); return; }

    const { error: sourceError } = await supabase.from("batches").update({ merged_into_batch_id: targetBatchId }).eq("id", sourceBatchId);
    if (sourceError) showToast("error", "The brew day was added, but couldn't mark the source batch as merged — check your connection.");

    setBatches((prev) =>
      prev.map((b) => {
        if (b.id === targetBatchId) return { ...b, brewDays: newBrewDays, volume: newVolume, ingredients: newIngredients, ingredientCost: newIngredientCost };
        if (b.id === sourceBatchId) return { ...b, mergedIntoBatchId: targetBatchId };
        return b;
      })
    );
    showToast("success", `${sourceBatch.name} merged in as a brew day — ${sourceBatch.volume}L.`);
    logActivity("updated", "batch", targetBatch.name, `${sourceBatch.name} (#${sourceBatch.number}) merged into ${targetBatch.name} (#${targetBatch.number}) as a brew day`);
  };

  const addBrewDay = async (batchId, entry) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;

    let addedCost = 0;
    const inventoryUpdates = [];
    for (const ing of entry.ingredients) {
      const item = inventory.find((it) => sameItemName(it.name, ing.name));
      if (!item) continue;
      const { updatedLots, cost } = deductFromLotsFIFO(item.lots, ing.qty);
      addedCost += cost;
      const newQty = Math.max(0, Math.round((item.qty - ing.qty) * 100) / 100);
      const historyEntry = { id: uid(), date: new Date().toISOString(), user: user.name, type: "batch", delta: -ing.qty, note: `${batch.name} (#${batch.number}) — brew day` };
      inventoryUpdates.push({ item, newQty, updatedLots, newHistory: [...(item.history || []), historyEntry] });
    }

    const brewDayEntry = { id: uid(), date: entry.date, volume: entry.volume, og: entry.og, ingredients: entry.ingredients };
    const newBrewDays = [...(batch.brewDays || []), brewDayEntry];
    const newVolume = Math.round((batch.volume + entry.volume) * 100) / 100;
    const newIngredients = [...batch.ingredients, ...entry.ingredients.map((i) => ({ ...i, id: uid() }))];
    const newIngredientCost = Math.round(((batch.ingredientCost || 0) + addedCost) * 100) / 100;

    const { error } = await supabase
      .from("batches")
      .update({ brew_days: newBrewDays, volume: newVolume, ingredients: newIngredients, ingredient_cost: newIngredientCost })
      .eq("id", batchId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) =>
      prev.map((b) => (b.id === batchId ? { ...b, brewDays: newBrewDays, volume: newVolume, ingredients: newIngredients, ingredientCost: newIngredientCost } : b))
    );

    for (const u of inventoryUpdates) {
      const { error: invError } = await supabase.from("inventory_items").update({ qty: u.newQty, lots: u.updatedLots, history: u.newHistory }).eq("id", u.item.id);
      if (!invError) setInventory((prev) => prev.map((it) => (it.id === u.item.id ? { ...it, qty: u.newQty, lots: u.updatedLots, history: u.newHistory } : it)));
    }
    showToast("success", `Brew day added — ${entry.volume}L.`);
  };

  const addInventoryItem = async (item) => {
    const { data, error } = await supabase.from("inventory_items").insert(inventoryItemToRow(item, user.id, profile.companyId)).select().single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setInventory((prev) => [rowToInventoryItem(data), ...prev]);
    showToast("success", `${item.name} added to inventory.`);
  };

  // The ABV actually printed on the packaging for a batch — separate from
  // the measured reading, since Customs recognises label strength as its
  // own valid method for smaller beer producers, under specific conditions.
  const setBatchLabelAbv = async (batchId, labelAbv) => {
    const b = batches.find((x) => x.id === batchId);
    const lockedMonth = b && packagingEvents(b).map((e) => monthKeyFromDate(e.date)).find((k) => exciseReturns.some((r) => r.period === k && r.declaredOnTsw));
    if (lockedMonth) {
      showToast("error", `${monthLabelFromKey(lockedMonth)} is ticked as declared on TSW — untick it in Excise first to change this strength.`);
      return false;
    }
    const { error } = await supabase.from("batches").update({ label_abv: labelAbv }).eq("id", batchId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, labelAbv } : b)));
  };

  const renameInventoryItem = async (id, name) => {
    const { error } = await supabase.from("inventory_items").update({ name }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setInventory((prev) => prev.map((it) => (it.id === id ? { ...it, name } : it)));
  };

  const updateInventoryItemDetails = async (id, patch) => {
    const item = inventory.find((it) => it.id === id);
    const row = { name: patch.name, category: patch.category };
    const next = { name: patch.name, category: patch.category };
    if (patch.juiceSg !== undefined) { row.juice_sg = patch.juiceSg; next.juiceSg = patch.juiceSg; }
    if (item && patch.unit && patch.unit !== item.unit) {
      // Changing the unit: convert stock, lots and costs where the units
      // convert (kg↔g, L↔mL); otherwise keep the numbers as they are.
      const f = patch.unitFactor || 1;
      const conv = (n) => (n == null ? n : Math.round(Number(n) * f * 1000) / 1000);
      next.unit = row.unit = patch.unit;
      next.qty = row.qty = conv(item.qty);
      next.threshold = row.threshold = conv(item.threshold);
      next.lots = row.lots = (item.lots || []).map((l) => ({ ...l, qty: conv(l.qty), remainingQty: conv(l.remainingQty), ...(l.unitCost != null ? { unitCost: Number(l.unitCost) / f } : {}) }));
      next.history = row.history = [...(item.history || []), { id: uid(), date: new Date().toISOString(), user: user.name, type: "manual", delta: 0, note: `Unit changed from ${item.unit} to ${patch.unit}` }];
    }
    const { error } = await supabase.from("inventory_items").update(row).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setInventory((prev) => prev.map((it) => (it.id === id ? { ...it, ...next } : it)));
    showToast("success", "Item updated.");
  };

  // Same lot shape a PO receipt creates, just entered directly — for
  // stock that came in without a formal PO, so it's still traceable.
  // One pass over several items at once — creates whichever ones don't
  // exist yet, then adds a real, dated lot to each, same underlying
  // effect as addManualLot just run line by line for a whole batch of
  // opening stock instead of one item at a time.
  const addBulkOpeningStock = async (lines) => {
    let nextInventory = [...inventory];
    let successCount = 0;
    for (const line of lines) {
      let item = nextInventory.find((it) => sameItemName(it.name, line.name));
      if (!item) {
        const newItemPayload = { id: uid(), name: line.name, category: line.category, qty: 0, unit: line.unit, threshold: 0 };
        const { data, error } = await supabase.from("inventory_items").insert(inventoryItemToRow(newItemPayload, user.id, profile.companyId)).select().single();
        if (error) { showToast("error", `Couldn't create ${line.name} — check your connection and try again.`); continue; }
        item = rowToInventoryItem(data);
        nextInventory = [item, ...nextInventory];
      }
      const lotEntry = { id: uid(), lotNumber: line.lotNumber, qty: line.qty, remainingQty: line.qty, date: today(), poNumber: null, unitCost: line.unitCost };
      const historyEntry = { id: uid(), date: new Date().toISOString(), user: user.name, type: "received", delta: line.qty, note: `Opening stock — ${line.lotNumber}` };
      const newQty = Math.round((item.qty + line.qty) * 100) / 100;
      const newLots = [...(item.lots || []), lotEntry];
      const newHistory = [...(item.history || []), historyEntry];
      const { error: updateError } = await supabase.from("inventory_items").update({ qty: newQty, lots: newLots, history: newHistory }).eq("id", item.id);
      if (updateError) { showToast("error", `Couldn't save stock for ${line.name} — check your connection and try again.`); continue; }
      nextInventory = nextInventory.map((it) => (it.id === item.id ? { ...it, qty: newQty, lots: newLots, history: newHistory } : it));
      successCount++;
    }
    setInventory(nextInventory);
    showToast("success", `${successCount} item${successCount !== 1 ? "s" : ""} brought in.`);
  };

  const addBulkOpeningStockConsumables = async (lines) => {
    let nextConsumables = [...consumables];
    let successCount = 0;
    for (const line of lines) {
      let item = nextConsumables.find((it) => sameItemName(it.name, line.name));
      if (!item) {
        const newItemPayload = { id: uid(), name: line.name, category: line.category, qty: 0, unit: line.unit, threshold: 0 };
        const { data, error } = await supabase.from("consumables").insert(consumableToRow(newItemPayload, user.id, profile.companyId)).select().single();
        if (error) { showToast("error", `Couldn't create ${line.name} — check your connection and try again.`); continue; }
        item = rowToConsumable(data);
        nextConsumables = [item, ...nextConsumables];
      }
      const lotEntry = { id: uid(), lotNumber: line.lotNumber, qty: line.qty, remainingQty: line.qty, date: today(), poNumber: null, unitCost: line.unitCost };
      const historyEntry = { id: uid(), date: new Date().toISOString(), user: user.name, type: "received", delta: line.qty, note: `Opening stock — ${line.lotNumber}` };
      const newQty = Math.round((item.qty + line.qty) * 100) / 100;
      const newLots = [...(item.lots || []), lotEntry];
      const newHistory = [...(item.history || []), historyEntry];
      const { error: updateError } = await supabase.from("consumables").update({ qty: newQty, lots: newLots, history: newHistory }).eq("id", item.id);
      if (updateError) { showToast("error", `Couldn't save stock for ${line.name} — check your connection and try again.`); continue; }
      nextConsumables = nextConsumables.map((it) => (it.id === item.id ? { ...it, qty: newQty, lots: newLots, history: newHistory } : it));
      successCount++;
    }
    setConsumables(nextConsumables);
    showToast("success", `${successCount} item${successCount !== 1 ? "s" : ""} brought in.`);
  };

  const addManualLot = async (itemId, entry) => {
    const item = inventory.find((it) => it.id === itemId);
    if (!item) return;
    const lotEntry = { id: uid(), lotNumber: entry.lotNumber, qty: entry.qty, remainingQty: entry.qty, date: entry.date, poNumber: null, unitCost: entry.unitCost };
    const historyEntry = { id: uid(), date: new Date().toISOString(), user: user.name, type: "received", delta: entry.qty, note: `Manual lot entry — ${entry.lotNumber}` };
    const newQty = Math.round((item.qty + entry.qty) * 100) / 100;
    const newLots = [...(item.lots || []), lotEntry];
    const newHistory = [...(item.history || []), historyEntry];
    const { error } = await supabase.from("inventory_items").update({ qty: newQty, lots: newLots, history: newHistory }).eq("id", itemId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setInventory((prev) => prev.map((it) => (it.id === itemId ? { ...it, qty: newQty, lots: newLots, history: newHistory } : it)));
    showToast("success", `Lot ${entry.lotNumber} added.`);
  };

  // Folds a duplicate item into the one you're keeping: its stock, lots and
  // history move across (converted if one is kg and the other g, etc.),
  // every recipe, batch and purchase order line that used its name is
  // pointed at the kept item, then the duplicate is removed.
  const mergeInventoryItems = async (source, target) => {
    const factor = unitFactor(source.unit, target.unit);
    if (factor == null || source.id === target.id) return false;
    const conv = (n) => (n == null || n === "" ? n : Math.round(Number(n) * factor * 1000) / 1000);
    const movedLots = (source.lots || []).map((l) => ({
      ...l,
      qty: conv(l.qty),
      remainingQty: conv(l.remainingQty),
      ...(l.unitCost != null ? { unitCost: Number(l.unitCost) / factor } : {}),
    }));
    const movedHistory = (source.history || []).map((h) => ({ ...h, delta: conv(h.delta), note: [h.note, `from ${source.name}`].filter(Boolean).join(" · ") }));
    const mergeEntry = { id: uid(), date: new Date().toISOString(), user: user.name, type: "manual", delta: 0, note: `Merged ${source.name} (${source.qty}${source.unit}) into this item` };
    const qty = Math.round((Number(target.qty) + Number(source.qty || 0) * factor) * 1000) / 1000;
    const lots = [...(target.lots || []), ...movedLots];
    const history = [...(target.history || []), ...movedHistory, mergeEntry].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const supplierId = target.supplierId || source.supplierId || null;
    const { error } = await supabase.from("inventory_items").update({ qty, lots, history, supplier_id: supplierId }).eq("id", target.id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return false; }

    // Point every line that used the duplicate's name at the kept item.
    const fixLines = (lines) => {
      let changed = false;
      const next = (lines || []).map((l) => {
        if (!l || !sameItemName(l.name, source.name)) return l;
        changed = true;
        const f = l.unit ? unitFactor(l.unit, target.unit) : null;
        return f != null && l.unit === source.unit && source.unit !== target.unit
          ? { ...l, name: target.name, qty: Math.round(Number(l.qty || 0) * f * 1000) / 1000, unit: target.unit }
          : { ...l, name: target.name };
      });
      return changed ? next : null;
    };
    const recipeUpdates = recipes.map((r) => ({ r, ing: fixLines(r.ingredients) })).filter((x) => x.ing);
    const batchUpdates = batches.map((b) => ({ b, ing: fixLines(b.ingredients) })).filter((x) => x.ing);
    const poUpdates = purchaseOrders.map((po) => ({ po, lines: fixLines(po.lines) })).filter((x) => x.lines);
    for (const { r, ing } of recipeUpdates) await supabase.from("recipes").update({ ingredients: ing }).eq("id", r.id);
    for (const { b, ing } of batchUpdates) await supabase.from("batches").update({ ingredients: ing }).eq("id", b.id);
    for (const { po, lines } of poUpdates) await supabase.from("purchase_orders").update({ lines }).eq("id", po.id);
    const { error: delError } = await supabase.from("inventory_items").delete().eq("id", source.id);
    if (delError) showToast("error", `Stock moved across, but ${source.name} couldn't be removed — delete it by hand.`);

    const rMap = Object.fromEntries(recipeUpdates.map((x) => [x.r.id, x.ing]));
    const bMap = Object.fromEntries(batchUpdates.map((x) => [x.b.id, x.ing]));
    const pMap = Object.fromEntries(poUpdates.map((x) => [x.po.id, x.lines]));
    setRecipes((prev) => prev.map((r) => (rMap[r.id] ? { ...r, ingredients: rMap[r.id] } : r)));
    setBatches((prev) => prev.map((b) => (bMap[b.id] ? { ...b, ingredients: bMap[b.id] } : b)));
    setPurchaseOrders((prev) => prev.map((po) => (pMap[po.id] ? { ...po, lines: pMap[po.id] } : po)));
    setInventory((prev) => prev.filter((it) => delError || it.id !== source.id).map((it) => (it.id === target.id ? { ...it, qty, lots, history, supplierId } : it)));
    setSelectedInventoryId(target.id);
    const refs = recipeUpdates.length + batchUpdates.length + poUpdates.length;
    logActivity("updated", "inventory", target.name, `Merged ${source.name} into ${target.name}`);
    showToast("success", `Merged ${source.name} into ${target.name}${refs ? ` — ${refs} recipe/batch/PO record${refs === 1 ? "" : "s"} updated` : ""}.`);
    return true;
  };

  const deleteInventoryItem = (item) => {
    askConfirm(
      `Delete ${item.name}? You'll have a few seconds to undo right after.`,
      () => {
        setInventory((prev) => prev.filter((it) => it.id !== item.id));
        setSelectedInventoryId(null);
        const timeoutId = setTimeout(async () => {
          delete pendingDeletesRef.current[item.id];
          const { error } = await supabase.from("inventory_items").delete().eq("id", item.id);
          if (error) showToast("error", "Something didn't save — check your connection and try again.");
        }, 5000);
        pendingDeletesRef.current[item.id] = timeoutId;
        showToast("success", `${item.name} deleted.`, {
          label: "Undo",
          onClick: () => {
            clearTimeout(pendingDeletesRef.current[item.id]);
            delete pendingDeletesRef.current[item.id];
            setInventory((prev) => [item, ...prev]);
          },
        });
      },
      { confirmLabel: "Delete", destructive: true }
    );
  };

  const updateInventorySupplier = async (id, supplierId) => {
    const { error } = await supabase.from("inventory_items").update({ supplier_id: supplierId }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setInventory((prev) => prev.map((it) => (it.id === id ? { ...it, supplierId } : it)));
  };

  const adjustInventory = async (id, delta) => {
    const item = inventory.find((it) => it.id === id);
    if (!item) return;
    const newQty = Math.max(0, Math.round((item.qty + delta) * 100) / 100);
    const actualDelta = Math.round((newQty - item.qty) * 100) / 100;
    // A reduction should come off actual lots too, or their remaining
    // amounts quietly drift out of sync with the real total — and
    // traceability's numbers stop being trustworthy.
    const lotsChanged = actualDelta < 0;
    const updatedLots = lotsChanged ? deductFromLotsFIFO(item.lots, -actualDelta).updatedLots : item.lots;
    const historyEntry = { id: uid(), date: new Date().toISOString(), user: user.name, type: "manual", delta: actualDelta, note: "Manual adjustment" };
    const newHistory = [...(item.history || []), historyEntry];
    const payload = lotsChanged ? { qty: newQty, lots: updatedLots, history: newHistory } : { qty: newQty, history: newHistory };
    const { error } = await supabase.from("inventory_items").update(payload).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setInventory((prev) => prev.map((it) => (it.id === id ? { ...it, qty: newQty, lots: updatedLots, history: newHistory } : it)));
  };

  const adjustInventoryWithNote = async (id, delta, batchRef) => {
    const item = inventory.find((it) => it.id === id);
    if (!item) return;
    const newQty = Math.max(0, Math.round((item.qty + delta) * 100) / 100);
    const actualDelta = Math.round((newQty - item.qty) * 100) / 100;
    const lotsChanged = actualDelta < 0;
    const updatedLots = lotsChanged ? deductFromLotsFIFO(item.lots, -actualDelta).updatedLots : item.lots;
    const historyEntry = {
      id: uid(),
      date: new Date().toISOString(),
      user: user.name,
      type: "manual",
      delta: actualDelta,
      note: batchRef ? `Manual adjustment — Batch ${batchRef}` : "Manual adjustment",
    };
    const newHistory = [...(item.history || []), historyEntry];
    const payload = lotsChanged ? { qty: newQty, lots: updatedLots, history: newHistory } : { qty: newQty, history: newHistory };
    const { error } = await supabase.from("inventory_items").update(payload).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setInventory((prev) => prev.map((it) => (it.id === id ? { ...it, qty: newQty, lots: updatedLots, history: newHistory } : it)));
  };

  // Undoes a manual adjustment by reversing its net effect on quantity and
  // removing it from the log. Doesn't attempt to restore exactly which
  // lots it originally deducted from — that detail isn't reliably
  // recoverable from the history entry alone, so this corrects the total
  // honestly rather than guessing at lot-level state.
  const deleteInventoryHistoryEntry = async (itemId, entry) => {
    const item = inventory.find((it) => it.id === itemId);
    if (!item) return;
    const newQty = Math.max(0, Math.round((item.qty - entry.delta) * 100) / 100);
    const newHistory = (item.history || []).filter((h) => h.id !== entry.id);
    const { error } = await supabase.from("inventory_items").update({ qty: newQty, history: newHistory }).eq("id", itemId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setInventory((prev) => prev.map((it) => (it.id === itemId ? { ...it, qty: newQty, history: newHistory } : it)));
    showToast("success", "Adjustment deleted.");
  };

  const addConsumable = async (item) => {
    const { data, error } = await supabase.from("consumables").insert(consumableToRow(item, user.id, profile.companyId)).select().single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setConsumables((prev) => [rowToConsumable(data), ...prev]);
    showToast("success", `${item.name} added to consumables.`);
  };

  const deleteConsumable = (item) => {
    askConfirm(
      `Delete ${item.name}? You'll have a few seconds to undo right after.`,
      () => {
        setConsumables((prev) => prev.filter((it) => it.id !== item.id));
        setSelectedConsumableId(null);
        const timeoutId = setTimeout(async () => {
          delete pendingDeletesRef.current[item.id];
          const { error } = await supabase.from("consumables").delete().eq("id", item.id);
          if (error) showToast("error", "Something didn't save — check your connection and try again.");
        }, 5000);
        pendingDeletesRef.current[item.id] = timeoutId;
        showToast("success", `${item.name} deleted.`, {
          label: "Undo",
          onClick: () => {
            clearTimeout(pendingDeletesRef.current[item.id]);
            delete pendingDeletesRef.current[item.id];
            setConsumables((prev) => [item, ...prev]);
          },
        });
      },
      { confirmLabel: "Delete", destructive: true }
    );
  };

  const updateConsumableSupplier = async (id, supplierId) => {
    const { error } = await supabase.from("consumables").update({ supplier_id: supplierId }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setConsumables((prev) => prev.map((it) => (it.id === id ? { ...it, supplierId } : it)));
  };

  const updateConsumableCost = async (id, costPerUnit) => {
    const { error } = await supabase.from("consumables").update({ cost_per_unit: costPerUnit }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setConsumables((prev) => prev.map((it) => (it.id === id ? { ...it, costPerUnit } : it)));
    showToast("success", "Cost updated.");
  };

  const renameConsumable = async (id, name) => {
    const { error } = await supabase.from("consumables").update({ name }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setConsumables((prev) => prev.map((it) => (it.id === id ? { ...it, name } : it)));
  };

  const updateConsumableDetails = async (id, patch) => {
    const { error } = await supabase.from("consumables").update({ name: patch.name, category: patch.category }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setConsumables((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    showToast("success", "Item updated.");
  };

  const adjustConsumable = async (id, delta) => {
    const item = consumables.find((it) => it.id === id);
    if (!item) return;
    const newQty = Math.max(0, Math.round((item.qty + delta) * 100) / 100);
    const actualDelta = Math.round((newQty - item.qty) * 100) / 100;
    const historyEntry = { id: uid(), date: new Date().toISOString(), user: user.name, type: "manual", delta: actualDelta, note: "Manual adjustment" };
    const newHistory = [...(item.history || []), historyEntry];
    const { error } = await supabase.from("consumables").update({ qty: newQty, history: newHistory }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setConsumables((prev) => prev.map((it) => (it.id === id ? { ...it, qty: newQty, history: newHistory } : it)));
  };

  const adjustConsumableWithNote = async (id, delta, batchRef) => {
    const item = consumables.find((it) => it.id === id);
    if (!item) return;
    const newQty = Math.max(0, Math.round((item.qty + delta) * 100) / 100);
    const actualDelta = Math.round((newQty - item.qty) * 100) / 100;
    const historyEntry = {
      id: uid(),
      date: new Date().toISOString(),
      user: user.name,
      type: "manual",
      delta: actualDelta,
      note: batchRef ? `Manual adjustment — Batch ${batchRef}` : "Manual adjustment",
    };
    const newHistory = [...(item.history || []), historyEntry];
    const { error } = await supabase.from("consumables").update({ qty: newQty, history: newHistory }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setConsumables((prev) => prev.map((it) => (it.id === id ? { ...it, qty: newQty, history: newHistory } : it)));
  };

  const deleteConsumableHistoryEntry = async (itemId, entry) => {
    const item = consumables.find((it) => it.id === itemId);
    if (!item) return;
    const newQty = Math.max(0, Math.round((item.qty - entry.delta) * 100) / 100);
    const newHistory = (item.history || []).filter((h) => h.id !== entry.id);
    const { error } = await supabase.from("consumables").update({ qty: newQty, history: newHistory }).eq("id", itemId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setConsumables((prev) => prev.map((it) => (it.id === itemId ? { ...it, qty: newQty, history: newHistory } : it)));
    showToast("success", "Adjustment deleted.");
  };

  const addPackageType = async (packageType) => {
    const { data, error } = await supabase.from("package_types").insert(packageTypeToRow(packageType, user.id, profile.companyId)).select().single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setPackageTypes((prev) => [rowToPackageType(data), ...prev]);
    showToast("success", `${packageType.name} added.`);
  };

  const renamePackageType = async (id, name) => {
    const { error } = await supabase.from("package_types").update({ name }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setPackageTypes((prev) => prev.map((pt) => (pt.id === id ? { ...pt, name } : pt)));
  };

  const deletePackageType = async (id) => {
    const packageType = packageTypes.find((pt) => pt.id === id);
    if (!packageType) return;
    setPackageTypes((prev) => prev.filter((pt) => pt.id !== id));
    setSelectedPackageTypeId(null);
    const timeoutId = setTimeout(async () => {
      delete pendingDeletesRef.current[id];
      const { error } = await supabase.from("package_types").delete().eq("id", id);
      if (error) showToast("error", "Something didn't save — check your connection and try again.");
    }, 5000);
    pendingDeletesRef.current[id] = timeoutId;
    showToast("success", `${packageType.name} deleted.`, {
      label: "Undo",
      onClick: () => {
        clearTimeout(pendingDeletesRef.current[id]);
        delete pendingDeletesRef.current[id];
        setPackageTypes((prev) => [packageType, ...prev]);
      },
    });
  };

  const createReorderPO = async (supplierName, items) => {
    const po = {
      id: uid(),
      poNumber: nextPONumber,
      supplier: supplierName,
      orderDate: today(),
      receivedDate: null,
      status: "Draft",
      deliveryCost: null,
      lines: items.map((it) => ({
        id: uid(),
        name: it.name,
        category: it.category,
        qty: Math.max(it.threshold * 2 - it.qty, it.threshold, 1),
        unit: it.unit,
        costPerUnit: it.costPerUnit ?? null,
      })),
    };
    await addPO(po);
    setView("orders");
    setSelectedPOId(po.id);
  };

  const addPO = async (po) => {
    const { data, error } = await supabase.from("purchase_orders").insert(poToRow(po, user.id, profile.companyId)).select().single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setPurchaseOrders((prev) => [rowToPO(data), ...prev]);
    showToast("success", `${po.poNumber} created.`);
    logActivity("created", "purchase order", po.poNumber, `Purchase order ${po.poNumber} created for ${po.supplier}`);
  };

  // Only for Draft/Sent orders — a Received PO has already moved into
  // real inventory with real lots, so editing it after the fact would
  // leave those records out of sync with whatever changed here.
  const updatePO = async (id, patch) => {
    const po = purchaseOrders.find((p) => p.id === id);
    if (!po) return;
    const updated = { ...po, ...patch };
    const { error } = await supabase
      .from("purchase_orders")
      .update(poToRow(updated, user.id, profile.companyId))
      .eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setPurchaseOrders((prev) => prev.map((p) => (p.id === id ? updated : p)));
    showToast("success", `${po.poNumber} updated.`);
    logActivity("updated", "purchase order", po.poNumber, `Purchase order ${po.poNumber} edited`);
  };

  const deletePO = (po) => {
    askConfirm(
      `Delete ${po.poNumber}? You'll have a few seconds to undo right after.`,
      () => {
        setPurchaseOrders((prev) => prev.filter((p) => p.id !== po.id));
        setSelectedPOId(null);
        logActivity("deleted", "purchase order", po.poNumber, `Purchase order ${po.poNumber} deleted`);
        const timeoutId = setTimeout(async () => {
          delete pendingDeletesRef.current[po.id];
          const { error } = await supabase.from("purchase_orders").delete().eq("id", po.id);
          if (error) showToast("error", "Something didn't save — check your connection and try again.");
        }, 5000);
        pendingDeletesRef.current[po.id] = timeoutId;
        showToast("success", `${po.poNumber} deleted.`, {
          label: "Undo",
          onClick: () => {
            clearTimeout(pendingDeletesRef.current[po.id]);
            delete pendingDeletesRef.current[po.id];
            setPurchaseOrders((prev) => [po, ...prev]);
          },
        });
      },
      { confirmLabel: "Delete", destructive: true }
    );
  };

  const markPOSent = async (id) => {
    const { error } = await supabase.from("purchase_orders").update({ status: "Sent" }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setPurchaseOrders((prev) => prev.map((p) => (p.id === id ? { ...p, status: "Sent" } : p)));
  };

  const receivePO = async (id, lotNumbers, costOverrides, deliveryCostOverride, receivedOn, lineMatches) => {
    const rawPo = purchaseOrders.find((p) => p.id === id);
    if (!rawPo) return;
    const po = { ...rawPo, lines: rawPo.lines.map((l) => applyLineMatch(l, lineMatches)) };

    // A delivery docket's actual price can differ from what was quoted
    // when the order was placed — costOverrides lets the real, received
    // price win, falling back to the original PO line if nothing changed.
    const effectiveCost = (line) => {
      const override = costOverrides && costOverrides[line.id];
      return override != null ? override / (line._f || 1) : line.costPerUnit;
    };

    // Delivery cost is spread across lines in proportion to each line's own
    // value — a line that's a bigger share of the order's cost carries a
    // bigger share of the delivery cost too. The freight charge itself can
    // be added or changed at receiving time too, for when it arrives on a
    // separate invoice rather than the supplier's own.
    const totalValue = po.lines.reduce((sum, l) => sum + (l.qty || 0) * (effectiveCost(l) || 0), 0);
    const deliveryCost = deliveryCostOverride != null ? deliveryCostOverride : po.deliveryCost || 0;

    let nextInventory = [...inventory];
    const finalizedLines = [];
    for (const line of po.lines) {
      const lotNumber = (lotNumbers && lotNumbers[line.id] && lotNumbers[line.id].trim()) || "no lot #";
      const costPerUnit = effectiveCost(line);
      const { _f, ...plainLine } = line;
      finalizedLines.push({ ...plainLine, lotNumber, costPerUnit });
      const idx = nextInventory.findIndex((it) => sameItemName(it.name, line.name));
      const lineValue = (line.qty || 0) * (costPerUnit || 0);
      const deliveryShare = totalValue > 0 ? (lineValue / totalValue) * deliveryCost : 0;
      const unitCost = costPerUnit != null ? costPerUnit + (line.qty > 0 ? deliveryShare / line.qty : 0) : null;
      const lotEntry = { id: uid(), lotNumber, qty: line.qty, remainingQty: line.qty, date: (receivedOn || today()), poNumber: po.poNumber, unitCost };
      const historyEntry = { id: uid(), date: stampForDate(receivedOn), user: user.name, type: "received", delta: line.qty, note: `${po.poNumber} — ${po.supplier}` };

      if (idx >= 0) {
        const item = nextInventory[idx];
        const newQty = Math.round((item.qty + line.qty) * 100) / 100;
        const newLots = [...(item.lots || []), lotEntry];
        const newHistory = [...(item.history || []), historyEntry];
        const { error } = await supabase.from("inventory_items").update({ qty: newQty, lots: newLots, history: newHistory }).eq("id", item.id);
        if (error) {
          showToast("error", "Something didn't save — check your connection and try again.");
          continue;
        }
        nextInventory[idx] = { ...item, qty: newQty, lots: newLots, history: newHistory };
      } else {
        const newItem = { id: uid(), name: line.name, category: line.category, qty: line.qty, unit: line.unit, threshold: 0, lots: [lotEntry], history: [historyEntry] };
        const { data, error } = await supabase.from("inventory_items").insert(inventoryItemToRow(newItem, user.id, profile.companyId)).select().single();
        if (error) {
          showToast("error", "Something didn't save — check your connection and try again.");
          continue;
        }
        nextInventory = [rowToInventoryItem(data), ...nextInventory];
      }
    }
    setInventory(nextInventory);

    const { error: poError } = await supabase
      .from("purchase_orders")
      .update({ status: "Received", received_date: (receivedOn || today()), lines: finalizedLines, delivery_cost: deliveryCost })
      .eq("id", id);
    if (poError) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setPurchaseOrders((prev) => prev.map((p) => (p.id === id ? { ...p, status: "Received", receivedDate: (receivedOn || today()), lines: finalizedLines, deliveryCost } : p)));
    showToast("success", `${po.poNumber} received — inventory updated.`);
    logActivity("received", "purchase order", po.poNumber, `Purchase order ${po.poNumber} received from ${po.supplier} — inventory updated`);
  };

  // Two or more separately-placed orders that arrived in the same delivery
  // — the freight charge gets split proportionally across every line from
  // every order combined, not just one PO's lines, and each PO ends up
  // storing its own genuine share of that shared cost.
  const receiveMultiplePOs = async (poIds, lotNumbers, costOverrides, deliveryCostOverride, receivedOn, lineMatches) => {
    const pos = purchaseOrders.filter((p) => poIds.includes(p.id));
    if (pos.length === 0) return;
    const allLines = pos.flatMap((p) => p.lines.map((l) => ({ ...applyLineMatch(l, lineMatches), _poId: p.id })));

    const effectiveCost = (line) => {
      const override = costOverrides && costOverrides[line.id];
      return override != null ? override / (line._f || 1) : line.costPerUnit;
    };

    const totalValue = allLines.reduce((sum, l) => sum + (l.qty || 0) * (effectiveCost(l) || 0), 0);
    const deliveryCost = deliveryCostOverride != null ? deliveryCostOverride : pos.reduce((sum, p) => sum + (p.deliveryCost || 0), 0);

    let nextInventory = [...inventory];
    const finalizedLinesByPO = {};
    const deliverySharesByPO = {};
    pos.forEach((p) => {
      finalizedLinesByPO[p.id] = [];
      deliverySharesByPO[p.id] = 0;
    });

    for (const line of allLines) {
      const poForLine = pos.find((p) => p.id === line._poId);
      const lotNumber = (lotNumbers && lotNumbers[line.id] && lotNumbers[line.id].trim()) || "no lot #";
      const costPerUnit = effectiveCost(line);
      const { _poId, _f, ...cleanLine } = line;
      finalizedLinesByPO[line._poId].push({ ...cleanLine, lotNumber, costPerUnit });
      const idx = nextInventory.findIndex((it) => sameItemName(it.name, line.name));
      const lineValue = (line.qty || 0) * (costPerUnit || 0);
      const deliveryShare = totalValue > 0 ? (lineValue / totalValue) * deliveryCost : 0;
      deliverySharesByPO[line._poId] += deliveryShare;
      const unitCost = costPerUnit != null ? costPerUnit + (line.qty > 0 ? deliveryShare / line.qty : 0) : null;
      const lotEntry = { id: uid(), lotNumber, qty: line.qty, remainingQty: line.qty, date: (receivedOn || today()), poNumber: poForLine.poNumber, unitCost };
      const historyEntry = { id: uid(), date: stampForDate(receivedOn), user: user.name, type: "received", delta: line.qty, note: `${poForLine.poNumber} — ${poForLine.supplier} (combined delivery)` };

      if (idx >= 0) {
        const item = nextInventory[idx];
        const newQty = Math.round((item.qty + line.qty) * 100) / 100;
        const newLots = [...(item.lots || []), lotEntry];
        const newHistory = [...(item.history || []), historyEntry];
        const { error } = await supabase.from("inventory_items").update({ qty: newQty, lots: newLots, history: newHistory }).eq("id", item.id);
        if (error) { showToast("error", "Something didn't save — check your connection and try again."); continue; }
        nextInventory[idx] = { ...item, qty: newQty, lots: newLots, history: newHistory };
      } else {
        const newItem = { id: uid(), name: line.name, category: line.category, qty: line.qty, unit: line.unit, threshold: 0, lots: [lotEntry], history: [historyEntry] };
        const { data, error } = await supabase.from("inventory_items").insert(inventoryItemToRow(newItem, user.id, profile.companyId)).select().single();
        if (error) { showToast("error", "Something didn't save — check your connection and try again."); continue; }
        nextInventory = [rowToInventoryItem(data), ...nextInventory];
      }
    }
    setInventory(nextInventory);

    for (const p of pos) {
      const share = Math.round(deliverySharesByPO[p.id] * 100) / 100;
      const { error: poError } = await supabase
        .from("purchase_orders")
        .update({ status: "Received", received_date: (receivedOn || today()), lines: finalizedLinesByPO[p.id], delivery_cost: share })
        .eq("id", p.id);
      if (poError) showToast("error", `Something didn't save for ${p.poNumber} — check your connection and try again.`);
    }
    setPurchaseOrders((prev) =>
      prev.map((p) => {
        const match = pos.find((x) => x.id === p.id);
        if (!match) return p;
        return { ...p, status: "Received", receivedDate: (receivedOn || today()), lines: finalizedLinesByPO[p.id], deliveryCost: Math.round(deliverySharesByPO[p.id] * 100) / 100 };
      })
    );
    const poNumbers = pos.map((p) => p.poNumber).join(" & ");
    showToast("success", `${poNumbers} received together — inventory updated.`);
    logActivity("received", "purchase order", poNumbers, `${pos.length} purchase orders received together as one combined delivery — inventory updated`);
  };

  const advance = async (id, date) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const stages = getStages(hasBriteTanks);
    const idx = stages.indexOf(batch.stage);
    if (idx >= stages.length - 1) return;
    const nextStage = stages[idx + 1];
    if (batch.stage === "Primary" && nextStage === "Cooling") {
      const hasPass = (batch.diacetylTests || []).some((t) => t.result === "pass");
      if (!hasPass) return;
    }
    const stageDates = withStageDate(batch, nextStage, date);
    const { error } = await supabase.from("batches").update({ stage: nextStage, stage_dates: stageDates }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, stage: nextStage, stageDates } : b)));
    logActivity("advanced", "batch", batch.name, `${batch.name} (#${batch.number}) moved to ${nextStage}${date && date < today() ? ` (backdated to ${date})` : ""}`);
  };

  const moveStageBack = async (id) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const stages = getStages(hasBriteTanks);
    const idx = stages.indexOf(batch.stage);
    if (idx <= 0) return;
    const prevStage = stages[idx - 1];
    const { error } = await supabase.from("batches").update({ stage: prevStage }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, stage: prevStage } : b)));
  };

  const setBrewSubStage = async (id, brewStage) => {
    const { error } = await supabase.from("batches").update({ brew_stage: brewStage }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, brewStage } : b)));
  };

  // Moves a batch to a different vessel mid-brew-day (Mash Tun → Kettle →
  // Fermenter). Because occupancy is just "which batch currently has this
  // tank_id," simply changing tank_id automatically frees the old vessel —
  // no separate release step needed. Reaching a Fermenter is what actually
  // advances the batch's real stage to Primary.
  const transferBatchVessel = async (id, tank, brewStage, newStage, date) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const patch = { tank_id: tank.id, tank_name: tank.name, brew_stage: brewStage };
    const stageDates = newStage ? withStageDate(batch, newStage, date) : null;
    if (newStage) { patch.stage = newStage; patch.stage_dates = stageDates; }
    const { error } = await supabase.from("batches").update(patch).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) =>
      prev.map((b) => (b.id === id ? { ...b, tankId: tank.id, tankName: tank.name, brewStage, ...(newStage ? { stage: newStage, stageDates } : {}) } : b))
    );
    logActivity("advanced", "batch", batch.name, `${batch.name} (#${batch.number}) moved to ${tank.name}${newStage ? ` — ${newStage}` : ""}`);
    resetTankClean(tank.id, batch);
  };

  // From the kettle, a batch can go into one fermenter or split across
  // several — this handles both, and either way it's what actually moves
  // the batch's real stage into Primary.
  const transferToFermenter = async (id, tanksChosen, date) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;

    if (tanksChosen.length === 1) {
      const tank = tanksChosen[0];
      const stageDates = withStageDate(batch, "Primary", date);
      const patch = { tank_id: tank.tankId, tank_name: tank.tankName, split_tanks: [], brew_stage: null, stage: "Primary", stage_dates: stageDates };
      const { error } = await supabase.from("batches").update(patch).eq("id", id);
      if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
      setBatches((prev) =>
        prev.map((b) => (b.id === id ? { ...b, tankId: tank.tankId, tankName: tank.tankName, splitTanks: [], brewStage: null, stage: "Primary", stageDates } : b))
      );
      logActivity("advanced", "batch", batch.name, `${batch.name} (#${batch.number}) moved to ${tank.tankName} — Primary`);
      resetTankClean(tank.tankId, batch);
      return;
    }

    // Splitting across several fermenters: from this point on each one needs
    // its own stage, readings, and history — a shared splitTanks field on
    // one record can't represent that once they diverge. So this creates a
    // genuinely separate, lettered batch per fermenter (sharing the brew-day
    // history up to now) and retires the original kettle-stage record.
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const totalSplitVolume = tanksChosen.reduce((sum, t) => sum + (Number(t.volume) || 0), 0);
    const splitGroupId = uid();
    const newBatches = tanksChosen.map((t, i) => {
      const suffix = letters[i] || String(i + 1);
      const share = totalSplitVolume > 0 ? t.volume / totalSplitVolume : 0;
      return {
        ...batch,
        id: uid(),
        number: `${batch.number}${suffix}`,
        name: `${batch.name} — ${suffix}`,
        volume: t.volume,
        tankId: t.tankId,
        tankName: t.tankName,
        splitTanks: [],
        splitGroupId,
        brewStage: null,
        stage: "Primary",
        stageDates: withStageDate(batch, "Primary", date),
        ingredientCost: batch.ingredientCost != null ? Math.round(batch.ingredientCost * share * 100) / 100 : null,
      };
    });

    for (const nb of newBatches) {
      const { error } = await supabase.from("batches").insert(batchToRow(nb, user.id, profile.companyId));
      if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    }
    const { error: deleteError } = await supabase.from("batches").delete().eq("id", id);
    if (deleteError) { showToast("error", "Something didn't save — check your connection and try again."); return; }

    setBatches((prev) => [...newBatches, ...prev.filter((b) => b.id !== id)]);
    setSelectedId(newBatches[0].id);
    const summary = newBatches.map((b) => `${b.name} (${b.tankName})`).join(" + ");
    showToast("success", `Split into ${newBatches.length} separate batches.`);
    logActivity("advanced", "batch", batch.name, `${batch.name} (#${batch.number}) split into ${summary} — Primary`);
    tanksChosen.forEach((t, i) => resetTankClean(t.tankId, newBatches[i]));
  };

  const logDiacetylTest = async (id, test) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const diacetylTests = [...(batch.diacetylTests || []), test];
    const { error } = await supabase.from("batches").update({ diacetyl_tests: diacetylTests }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, diacetylTests } : b)));
    showToast("success", `Diacetyl test logged: ${test.result}.`);
  };

  const toggleBatchFault = async (id, faultName, tankId) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;

    const buildNextFaults = (allEntries) => {
      const todayStr = today();
      const todaysEntry = allEntries.find((f) => f.fault === faultName && f.date === todayStr);
      if (todaysEntry) {
        // Same-day taps cycle through Low → Medium → High → off, same as before.
        const nextSeverity = FAULT_SEVERITY_NEXT[todaysEntry.severity];
        return nextSeverity === null
          ? allEntries.filter((f) => !(f.fault === faultName && f.date === todayStr))
          : allEntries.map((f) => (f.fault === faultName && f.date === todayStr ? { ...f, severity: nextSeverity } : f));
      }
      // First tap on a new day starts a fresh assessment at Low, regardless
      // of what an earlier day recorded — that entry stays put as history.
      return [...allEntries, { id: uid(), fault: faultName, severity: "Low", date: todayStr }];
    };

    if (tankId && batch.splitTanks && batch.splitTanks.length > 0) {
      const splitTanks = batch.splitTanks.map((t) => (t.tankId === tankId ? { ...t, faults: buildNextFaults(t.faults || []) } : t));
      const { error } = await supabase.from("batches").update({ split_tanks: splitTanks }).eq("id", id);
      if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
      setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, splitTanks } : b)));
      return;
    }

    const faults = buildNextFaults(batch.faults || []);
    const { error } = await supabase.from("batches").update({ faults }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, faults } : b)));
  };

  const logReading = async (id, reading, tankId) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    if (tankId && batch.splitTanks && batch.splitTanks.length > 0) {
      const splitTanks = batch.splitTanks.map((t) => (t.tankId === tankId ? { ...t, readings: insertByDate(t.readings, reading) } : t));
      const { error } = await supabase.from("batches").update({ split_tanks: splitTanks }).eq("id", id);
      if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
      setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, splitTanks } : b)));
      return;
    }
    const readings = insertByDate(batch.readings, reading);
    const { error } = await supabase.from("batches").update({ readings }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, readings } : b)));
  };

  const deleteReading = async (batchId, readingId, tankId) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;
    if (tankId && batch.splitTanks && batch.splitTanks.length > 0) {
      const side = batch.splitTanks.find((t) => t.tankId === tankId);
      if (!side || !side.readings || side.readings.length === 0) return;
      const splitTanks = batch.splitTanks.map((t) => (t.tankId === tankId ? { ...t, readings: t.readings.filter((r) => r.id !== readingId) } : t));
      const { error } = await supabase.from("batches").update({ split_tanks: splitTanks }).eq("id", batchId);
      if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
      setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, splitTanks } : b)));
      return;
    }
    if (batch.readings.length <= 1) return;
    const readings = batch.readings.filter((r) => r.id !== readingId);
    const { error } = await supabase.from("batches").update({ readings }).eq("id", batchId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, readings } : b)));
  };

  const BREW_DAY_FIELD_COLUMNS = {
    mashPh: "mash_ph",
    mashTemp: "mash_temp",
    preBoilGravity: "pre_boil_gravity",
    topUpWater: "top_up_water",
    phIntoTank: "ph_into_tank",
    sgIntoTank: "sg_into_tank",
  };

  const updateBrewDayField = async (id, field, value) => {
    const column = BREW_DAY_FIELD_COLUMNS[field];
    if (!column) return;
    const batch = batches.find((b) => b.id === id);

    // SG/pH into tank are the batch's real starting numbers, so the first
    // reading in the log should reflect them, not the recipe's target OG.
    let readings = batch?.readings;
    if (batch && readings && readings.length > 0 && (field === "sgIntoTank" || field === "phIntoTank") && value != null) {
      readings = readings.map((r, i) =>
        i === 0 ? { ...r, ...(field === "sgIntoTank" ? { gravity: value } : { ph: value }) } : r
      );
    }

    const patch = readings && readings !== batch.readings ? { [column]: value, readings } : { [column]: value };
    const { error } = await supabase.from("batches").update(patch).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) =>
      prev.map((b) => (b.id === id ? { ...b, [field]: value, ...(readings && readings !== batch.readings ? { readings } : {}) } : b))
    );
  };

  const toggleScheduleStep = async (batchId, stepId) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;
    const newSchedule = (batch.schedule || []).map((s) =>
      s.id === stepId ? { ...s, done: !s.done, doneAt: !s.done ? new Date().toISOString() : null } : s
    );
    const { error } = await supabase.from("batches").update({ schedule: newSchedule }).eq("id", batchId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, schedule: newSchedule } : b)));
  };

  const deductConsumablesForPackaging = async (batch, sessionCounts, packageTypeSelections, sign = -1, date) => {
    // Work out total qty to deduct (or, with sign=1, restore) per consumable
    // across every container type in this packaging session.
    const deductions = {}; // consumableId -> total qty
    let missingLabel = false;
    for (const c of CONTAINERS) {
      const count = Number(sessionCounts[c.key]) || 0;
      const packageTypeId = packageTypeSelections[c.key];
      if (count <= 0 || !packageTypeId) continue;
      const packageType = packageTypes.find((pt) => pt.id === packageTypeId);
      if (!packageType) continue;
      for (const item of packageType.items) {
        let consumableId = item.consumableId;
        if (item.matchLabelByRecipeName) {
          const beerName = (batch.recipeName || batch.name || "").trim().toLowerCase();
          const match = consumables.find((co) => co.category === "Label" && co.name.trim().toLowerCase() === beerName);
          if (!match) { missingLabel = true; continue; }
          consumableId = match.id;
        }
        if (!consumableId) continue;
        const qty = (Number(item.qtyPerUnit) || 0) * count;
        deductions[consumableId] = (deductions[consumableId] || 0) + qty;
      }
    }

    if (missingLabel) {
      showToast("error", `No matching Label consumable found for "${batch.recipeName || batch.name}" — that ${sign < 0 ? "deduction" : "return"} was skipped.`);
    }

    const ids = Object.keys(deductions);
    if (ids.length === 0) return;

    let nextConsumables = [...consumables];
    for (const consumableId of ids) {
      const item = nextConsumables.find((co) => co.id === consumableId);
      if (!item) continue;
      const delta = sign * deductions[consumableId];
      const newQty = Math.max(0, Math.round((item.qty + delta) * 100) / 100);
      const actualDelta = Math.round((newQty - item.qty) * 100) / 100;
      const historyEntry = {
        id: uid(),
        date: stampForDate(date),
        user: user.name,
        type: "batch",
        delta: actualDelta,
        note: sign < 0 ? `Packaging — ${batch.number || batch.name}` : `Undo packaging — ${batch.number || batch.name}`,
      };
      const newHistory = [...(item.history || []), historyEntry];
      const { error } = await supabase.from("consumables").update({ qty: newQty, history: newHistory }).eq("id", consumableId);
      if (error) { showToast("error", "Something didn't save — check your connection and try again."); continue; }
      nextConsumables = nextConsumables.map((co) => (co.id === consumableId ? { ...co, qty: newQty, history: newHistory } : co));
    }
    setConsumables(nextConsumables);
  };

  const logPackagingSession = async (id, sessionCounts, packageTypeSelections = {}, date, carryOn = null) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const sister = carryOn && batches.find((b) => b.id === carryOn.sisterId);
    if (sister) {
      // One run across two tanks of the same brew: empty this one, then the other.
      const { first, second, firstLeftL } = splitPackagingRun(sessionCounts, remainingVolume(batch));
      const any = (c) => CONTAINERS.some((x) => (c[x.key] || 0) > 0);
      const saveOne = async (b, counts, closeOff) => {
        const events = packagingEvents(b);
        const newEvents = any(counts) ? [...events, { id: uid(), date: date || today(), ...counts, packageTypes: packageTypeSelections }] : events;
        const discarded = Math.round((packagingDiscarded(b) + (closeOff || 0)) * 100) / 100;
        const newPackaging = { events: newEvents, discarded };
        const stageDates = withStageDate(b, "Packaged", date);
        const { error } = await supabase.from("batches").update({ packaging: newPackaging, stage: "Packaged", packaging_run: null, stage_dates: stageDates }).eq("id", b.id);
        if (error) { showToast("error", "Something didn't save — check your connection and try again."); return false; }
        setBatches((prev) => prev.map((x) => (x.id === b.id ? { ...x, packaging: newPackaging, stage: "Packaged", packagingRun: null, stageDates } : x)));
        if (any(counts)) {
          syncPackagingToXero(b, counts);
          await deductConsumablesForPackaging(b, counts, packageTypeSelections, -1, date);
        }
        return true;
      };
      if (!(await saveOne(batch, first, firstLeftL))) return;
      if (!(await saveOne(sister, second, 0))) return;
      logActivity("packaged", "batch", batch.name, `${batch.name} (#${batch.number}) packaged, then carried on from ${sister.name} (#${sister.number})`);
      showToast("success", `${batch.name} emptied; the rest of the run booked to ${sister.name}.`);
      return;
    }
    const events = packagingEvents(batch);
    const newEvent = { id: uid(), date: date || today(), ...sessionCounts, packageTypes: packageTypeSelections };
    const stageDates = withStageDate(batch, "Packaged", date);
    const newPackaging = { events: [...events, newEvent], discarded: packagingDiscarded(batch) };
    const { error } = await supabase.from("batches").update({ packaging: newPackaging, stage: "Packaged", packaging_run: null, stage_dates: stageDates }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, packaging: newPackaging, stage: "Packaged", packagingRun: null, stageDates } : b)));
    syncPackagingToXero(batch, sessionCounts);
    await deductConsumablesForPackaging(batch, sessionCounts, packageTypeSelections, -1, date);
    logActivity("packaged", "batch", batch.name, `${batch.name} (#${batch.number}) packaged`);
  };

  // First half of a packaging run — just records what's being packaged
  // into and when it started. The tank stays occupied and the batch's
  // real stage doesn't change until logPackagingSession finishes it.
  const startPackagingRun = async (id, containerType) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const packagingRun = { containerType, startedAt: new Date().toISOString() };
    const { error } = await supabase.from("batches").update({ packaging_run: packagingRun }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, packagingRun } : b)));
    logActivity("advanced", "batch", batch.name, `${batch.name} (#${batch.number}) started packaging (${containerType})`);
  };

  const setCarbonationChecked = async (id, checked) => {
    const { error } = await supabase.from("batches").update({ carbonation_checked: checked }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, carbonationChecked: checked } : b)));
  };

  // Optional brew-day checkboxes — hop dump, yeast dump. Purely
  // informational, never blocks anything.
  const setBrewDayCheckbox = async (id, field, checked) => {
    const column = field === "hopDumpDone" ? "hop_dump_done" : "yeast_dump_done";
    const { error } = await supabase.from("batches").update({ [column]: checked }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: checked } : b)));
  };

  const dumpColumn = (field) => (field === "hopDumpLog" ? "hop_dump_log" : "yeast_dump_log");

  const logDump = async (id, field, date) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const entry = { id: uid(), at: stampForDate(date), user: user.name };
    const log = [...(batch[field] || []), entry].sort((a, b) => (a.at || "").localeCompare(b.at || ""));
    const { error } = await supabase.from("batches").update({ [dumpColumn(field)]: log }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: log } : b)));
  };

  // The checkbox's "undo" — removes just the most recent entry, which is
  // always today's tick if there is one, since new entries only ever get
  // appended. Past days' entries are never touched by this.
  const undoDump = async (id, field) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const log = [...(batch[field] || [])];
    log.pop();
    const { error } = await supabase.from("batches").update({ [dumpColumn(field)]: log }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: log } : b)));
  };

  const addBatchNote = async (id, text, tankId, date) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const newNote = { id: uid(), date: stampForDate(date), text };
    if (tankId && batch.splitTanks && batch.splitTanks.length > 0) {
      const splitTanks = batch.splitTanks.map((t) => (t.tankId === tankId ? { ...t, notes: insertByDate(t.notes, newNote) } : t));
      const { error } = await supabase.from("batches").update({ split_tanks: splitTanks }).eq("id", id);
      if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
      setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, splitTanks } : b)));
      return;
    }
    const notes = insertByDate(batch.notes, newNote);
    const { error } = await supabase.from("batches").update({ notes }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, notes } : b)));
  };

  const deleteBatchNote = async (id, noteId, tankId) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    if (tankId && batch.splitTanks && batch.splitTanks.length > 0) {
      const splitTanks = batch.splitTanks.map((t) => (t.tankId === tankId ? { ...t, notes: (t.notes || []).filter((n) => n.id !== noteId) } : t));
      const { error } = await supabase.from("batches").update({ split_tanks: splitTanks }).eq("id", id);
      if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
      setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, splitTanks } : b)));
      return;
    }
    const notes = (batch.notes || []).filter((n) => n.id !== noteId);
    const { error } = await supabase.from("batches").update({ notes }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, notes } : b)));
  };

  const addTastingNote = async (id, entry) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const newEntry = { id: uid(), ...entry };
    const tastingLog = [...(batch.tastingLog || []), newEntry];
    const { error } = await supabase.from("batches").update({ tasting_log: tastingLog }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, tastingLog } : b)));
    showToast("success", "Tasting note saved.");
  };

  const addSensoryScore = async (id, entry) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const newEntry = { id: uid(), ...entry };
    const sensoryScores = [...(batch.sensoryScores || []), newEntry];
    const { error } = await supabase.from("batches").update({ sensory_scores: sensoryScores }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, sensoryScores } : b)));
    showToast("success", "Score saved.");
  };

  const addLabMeasurement = async (id, entry) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const newEntry = { id: uid(), ...entry };
    const labMeasurements = [...(batch.labMeasurements || []), newEntry];
    // A gravity measured here is a gravity reading too, so Current SG and
    // attenuation pick it up.
    const readings =
      entry.gravity != null
        ? [...(batch.readings || []), { id: uid(), date: entry.date, gravity: entry.gravity, temp: latestReading(batch).temp ?? null, ph: entry.ph ?? null, note: "Lab measurement" }].sort((a, b) => String(a.date).localeCompare(String(b.date)))
        : batch.readings;
    const update = entry.gravity != null ? { lab_measurements: labMeasurements, readings } : { lab_measurements: labMeasurements };
    const { error } = await supabase.from("batches").update(update).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, labMeasurements, readings } : b)));
    showToast("success", "Measurement saved.");
  };

  const saveQcApproval = async (id, approval) => {
    const { error } = await supabase.from("batches").update({ qc_approval: approval }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, qcApproval: approval } : b)));
    showToast("success", "Batch signed off for release.");
  };

  const saveTriangleTest = async (test) => {
    if (test.id) {
      const row = triangleTestToRow(test, profile.companyId);
      delete row.id;
      const { error } = await supabase.from("triangle_tests").update(row).eq("id", test.id);
      if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
      setTriangleTests((prev) => prev.map((t) => (t.id === test.id ? { ...t, ...test } : t)));
    } else {
      const row = triangleTestToRow(test, profile.companyId);
      delete row.id;
      const { data, error } = await supabase.from("triangle_tests").insert(row).select().single();
      if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
      setTriangleTests((prev) => [rowToTriangleTest(data), ...prev]);
    }
    showToast("success", "Triangle test saved.");
  };

  // ─── Excise self-audit ────────────────────────────────────────────────
  // Saves one month's declared return. The first save also freezes what
  // Brewpoint's own records said at that moment, so later edits to that
  // month's packaging show up as "changed since filing". Any edit clears
  // the reviewed sign-off, since it no longer covers what's there now.
  const saveExciseReturn = async (draft, month, newImages = [], opts = {}) => {
    const existing = exciseReturns.find((r) => r.period === draft.period);
    // "Replace" swaps out the old screenshots too; the files are only
    // removed once the new return has saved.
    const replacing = !!draft.replaceEvidence && !!existing;
    const oldPaths = replacing ? existing.screenshotPaths || [] : [];
    const paths = replacing ? [] : [...(existing?.screenshotPaths || [])];
    for (const img of newImages) {
      const path = `${profile.companyId}/${draft.period}/${uid()}.jpg`;
      const { error: upErr } = await supabase.storage.from("excise-evidence").upload(path, img.blob, { contentType: "image/jpeg" });
      if (upErr) { console.error(upErr); showToast("error", "A screenshot didn't upload — check your connection and try again."); return false; }
      paths.push(path);
    }
    const { replaceEvidence, evidenceOnly, ...fields } = draft;
    const record = {
      ...(existing || {}),
      ...fields,
      id: existing?.id,
      screenshotPaths: paths,
      appLitresAtFiling: existing?.appLitresAtFiling ?? month.appLitres,
      appLalAtFiling: existing?.appLalAtFiling ?? month.appLal,
      // Attaching evidence doesn't change any figure, so a sign-off stands.
      reviewedBy: evidenceOnly ? existing?.reviewedBy || "" : "",
      reviewedAt: evidenceOnly ? existing?.reviewedAt || null : null,
    };
    // Levy and the GST on it, worked out from the declared lines — TSW
    // charges both on top of the duty.
    if ((record.declaredLines || []).length) {
      const { levy, levyGst } = levyForDeclaredLines(record.declaredLines, record.period);
      record.declaredLevy = levy;
      record.declaredLevyGst = levyGst;
    }
    const row = exciseReturnToRow(record, profile.companyId);
    delete row.id;
    const { data, error } = await supabase.from("excise_returns").upsert(row, { onConflict: "company_id,period" }).select().single();
    if (error) { console.error(error); showToast("error", "Something didn't save — check your connection and try again."); return false; }
    const saved = rowToExciseReturn(data);
    if (oldPaths.length) await supabase.storage.from("excise-evidence").remove(oldPaths);
    setExciseReturns((prev) => [saved, ...prev.filter((r) => r.period !== saved.period)]);
    logActivity(existing ? "updated" : "created", "excise_return", saved.period, `Excise return for ${monthLabelFromKey(saved.period)} ${existing ? "updated" : "recorded"}`);
    if (!opts.quiet) showToast("success", `Return for ${monthLabelFromKey(saved.period)} saved.`);
    return true;
  };

  const importExciseScreenshotGroup = (g, month, opts = {}) => {
    const existing = exciseReturns.find((r) => r.period === g.period);
    if (g.mode === "evidence" && existing) {
      return saveExciseReturn(
        { period: g.period, entryNumber: existing.entryNumber || (g.entryNumber || "").trim(), filedDate: existing.filedDate || g.filedDate || "", evidenceOnly: true },
        month,
        g.images,
        opts
      );
    }
    return saveExciseReturn(
      {
        period: g.period,
        declaredLitres: g.declaredLitres,
        declaredLal: g.declaredLal,
        declaredDuty: g.declaredDuty,
        declaredLines: g.saveLines || g.lines || [],
        entryNumber: (g.entryNumber || "").trim(),
        filedDate: g.filedDate || "",
        replaceEvidence: g.mode === "replace",
      },
      month,
      g.images,
      opts
    );
  };

  const deleteExciseReturn = async (ret) => {
    if ((ret.screenshotPaths || []).length) await supabase.storage.from("excise-evidence").remove(ret.screenshotPaths);
    const { error } = await supabase.from("excise_returns").delete().eq("id", ret.id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setExciseReturns((prev) => prev.filter((r) => r.id !== ret.id));
    logActivity("deleted", "excise_return", ret.period, `Excise return for ${monthLabelFromKey(ret.period)} deleted`);
  };

  const setExciseDeclared = async (period, declared) => {
    const patch = declared
      ? { declared_on_tsw: true, declared_on_tsw_at: new Date().toISOString(), declared_on_tsw_by: profile.name || "Owner" }
      : { declared_on_tsw: false, declared_on_tsw_at: null, declared_on_tsw_by: null };
    const { data, error } = await supabase.from("excise_returns").upsert({ company_id: profile.companyId, period, ...patch }, { onConflict: "company_id,period" }).select().single();
    if (error) { console.error(error); showToast("error", "Something didn't save — check your connection and try again."); return false; }
    const saved = rowToExciseReturn(data);
    setExciseReturns((prev) => [saved, ...prev.filter((r) => r.period !== period)]);
    logActivity(declared ? "declared" : "undeclared", "excise_return", period, `${monthLabelFromKey(period)} ${declared ? "ticked as declared on TSW — label strengths locked" : "unticked — label strengths unlocked"}`);
    return true;
  };

  const reviewExciseReturn = async (ret) => {
    const reviewedAt = new Date().toISOString();
    const reviewedBy = profile.name || "Owner";
    const { error } = await supabase.from("excise_returns").update({ reviewed_by: reviewedBy, reviewed_at: reviewedAt }).eq("id", ret.id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setExciseReturns((prev) => prev.map((r) => (r.id === ret.id ? { ...r, reviewedBy, reviewedAt } : r)));
    logActivity("reviewed", "excise_return", ret.period, `Excise return for ${monthLabelFromKey(ret.period)} reviewed`);
    showToast("success", "Marked as reviewed.");
  };

  const readTswScreenshot = async (base64) => {
    const { data, error } = await supabase.functions.invoke("read-tsw-return", { body: { image: base64, mediaType: "image/jpeg" } });
    if (error) {
      let msg = "Couldn't read that screenshot — try again.";
      try { const body = await error.context?.json?.(); if (body?.error) msg = body.error; } catch { /* keep default */ }
      throw new Error(msg);
    }
    return data;
  };

  const viewExciseScreenshot = async (path) => {
    const { data, error } = await supabase.storage.from("excise-evidence").createSignedUrl(path, 120);
    if (error) { showToast("error", "Couldn't open that screenshot."); return; }
    window.open(data.signedUrl, "_blank");
  };

  const deleteTriangleTest = async (id) => {
    const { error } = await supabase.from("triangle_tests").delete().eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setTriangleTests((prev) => prev.filter((t) => t.id !== id));
  };

  const addVolumeTopup = async (id, entry) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const newEntry = { id: uid(), ...entry };
    const volumeTopups = [...(batch.volumeTopups || []), newEntry];
    const { error } = await supabase.from("batches").update({ volume_topups: volumeTopups }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, volumeTopups } : b)));
    showToast("success", "Top-up logged.");
  };

  // Generation follows how brewers actually talk about it: the original
  // fresh pitch is Generation 1, so the first harvest and repitch off it
  // is Generation 2, the next Generation 3, and so on.
  const harvestYeast = async (sourceBatch, entry) => {
    const parentHarvest = sourceBatch.pitchedYeastHarvestId
      ? yeastHarvests.find((h) => h.id === sourceBatch.pitchedYeastHarvestId)
      : null;
    const generation = parentHarvest ? (parentHarvest.generation || 1) + 1 : 2;
    const record = {
      id: uid(),
      strainName: entry.strainName,
      generation,
      amount: entry.amount,
      unit: entry.unit,
      sourceBatchId: sourceBatch.id,
      sourceBatchName: sourceBatch.name,
      harvestDate: today(),
      notes: entry.notes || null,
      used: false,
    };
    const row = yeastHarvestToRow(record, user.id, user.name, profile.companyId);
    delete row.id; // let Postgres generate the real UUID, same fix as customers/sales_orders
    const { data, error } = await supabase.from("yeast_harvests").insert(row).select().single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setYeastHarvests((prev) => [rowToYeastHarvest(data), ...prev]);
    showToast("success", `Harvested — Generation ${generation}.`);
  };

  // Pitching a harvested yeast into a fresh batch: mark it used (it's a
  // one-shot — once pitched, it's not still sitting on the shelf to pick
  // again) and link the new batch back to it, which is what lets the next
  // harvest off THIS batch know its own generation.
  const markYeastHarvestUsed = async (harvestId, newBatchId) => {
    const usedDate = today();
    const { error } = await supabase.from("yeast_harvests").update({ used: true, used_in_batch_id: newBatchId, used_date: usedDate }).eq("id", harvestId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setYeastHarvests((prev) => prev.map((h) => (h.id === harvestId ? { ...h, used: true, usedInBatchId: newBatchId, usedDate } : h)));
  };

  const saveMixedPackType = async (t) => {
    const existing = mixedPackTypes.find((x) => x.id === t.id);
    const row = mixedPackTypeToRow(t, profile.companyId);
    if (existing) {
      const { error } = await supabase.from("mixed_pack_types").update(row).eq("id", t.id);
      if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
      setMixedPackTypes((prev) => prev.map((x) => (x.id === t.id ? t : x)));
    } else {
      const insertRow = { ...row };
      delete insertRow.id; // let Postgres generate the real UUID, same fix as customers/sales_orders
      const { data, error } = await supabase.from("mixed_pack_types").insert(insertRow).select().single();
      if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
      setMixedPackTypes((prev) => [...prev, rowToMixedPackType(data)]);
    }
    showToast("success", `${t.name} saved.`);
  };

  // The core of the whole feature: consuming real stock from each
  // component beer and recording exactly what went into this batch of
  // packs, so both sides of the ledger — what's now unavailable on its
  // own, and what's now available as a pack — stay honest.
  const assembleMixedPack = async (mixedPackType, { quantity, composition }) => {
    const record = {
      id: uid(),
      mixedPackTypeId: mixedPackType.id,
      mixedPackTypeName: mixedPackType.name,
      quantity,
      composition,
      assembledDate: today(),
    };
    const row = mixedPackAssemblyToRow(record, user.id, user.name, profile.companyId);
    delete row.id; // let Postgres generate the real UUID, same fix as customers/sales_orders
    const { data, error } = await supabase.from("mixed_pack_assemblies").insert(row).select().single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setMixedPackAssemblies((prev) => [rowToMixedPackAssembly(data), ...prev]);
    showToast("success", `${quantity} × ${mixedPackType.name} assembled.`);
  };

  const setStillFermenting = async (id, value) => {
    const { error } = await supabase.from("batches").update({ still_fermenting: value }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, stillFermenting: value } : b)));
  };

  const updateTankSettings = async (id, entry) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const newEntry = { id: uid(), user: user.name, ...entry };
    const tankSettingsLog = [...(batch.tankSettingsLog || []), newEntry];
    const { error } = await supabase.from("batches").update({ tank_settings_log: tankSettingsLog }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, tankSettingsLog } : b)));
    showToast("success", "Tank settings updated.");
  };

  // Cancels a packaging run that was started but never finished. Nothing
  // gets deducted until logPackagingSession actually runs (that only
  // happens on "Finish packaging"), so there's genuinely nothing to give
  // back here — this just clears the in-progress marker.
  const cancelPackagingRun = async (id) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    askConfirm(
      "Cancel this packaging run? Nothing's been deducted yet, so the tank and your stock stay exactly as they are — this just clears the in-progress status.",
      async () => {
        const { error } = await supabase.from("batches").update({ packaging_run: null }).eq("id", id);
        if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
        setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, packagingRun: null } : b)));
        showToast("success", "Packaging run cancelled.");
      },
      { confirmLabel: "Cancel run", destructive: true }
    );
  };


  const undoPackagingEvent = async (id, eventId) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const event = packagingEvents(batch).find((e) => e.id === eventId);
    if (!event) return;
    askConfirm(
      "Undo this packaging run? It'll go back to the Cooling stage, and any consumables (cans, lids, boxes, labels) used for it will be returned to stock.",
      async () => {
        const events = packagingEvents(batch).filter((e) => e.id !== eventId);
        const newPackaging = { events, discarded: packagingDiscarded(batch) };
        const { error } = await supabase.from("batches").update({ packaging: newPackaging, stage: "Cooling" }).eq("id", id);
        if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
        setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, packaging: newPackaging, stage: "Cooling" } : b)));
        await deductConsumablesForPackaging(batch, event, event.packageTypes || {}, 1);
        showToast("success", "Packaging undone — back to Cooling, consumables returned to stock.");
        logActivity("undid packaging for", "batch", batch.name, `Packaging undone for ${batch.name} (#${batch.number})`);
      },
      { confirmLabel: "Undo packaging", destructive: true }
    );
  };

  const discardRemaining = async (id) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const events = packagingEvents(batch);
    const newDiscarded = packagingDiscarded(batch) + remainingVolume(batch);
    const newPackaging = { events, discarded: newDiscarded };
    const { error } = await supabase.from("batches").update({ packaging: newPackaging, stage: "Packaged" }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, packaging: newPackaging, stage: "Packaged" } : b)));
  };

  const deleteAccount = async () => {
    try {
      const { error } = await supabase.rpc("delete_my_account");
      if (error) {
        console.error(error);
        return { error: error.message };
      }
      setShowDeleteAccount(false);
      await supabase.auth.signOut();
      return { error: null };
    } catch (err) {
      console.error(err);
      return { error: (err && err.message) || "Something went wrong. Check your connection and try again." };
    }
  };

  const deleteCompany = async () => {
    try {
      const { error } = await supabase.rpc("delete_my_company");
      if (error) {
        console.error(error);
        return { error: error.message };
      }
      setShowDeleteCompany(false);
      await supabase.auth.signOut();
      return { error: null };
    } catch (err) {
      console.error(err);
      return { error: (err && err.message) || "Something went wrong. Check your connection and try again." };
    }
  };

  const hasBriteTanks = tanks.some((t) => t.type === "Brite Tank");
  const stages = getStages(hasBriteTanks);
  const fermentingBatches = batches.filter((b) => ["Brewing", "Primary", "Secondary"].includes(b.stage) && !b.mergedIntoBatchId);
  const conditioningBatches = batches.filter((b) => ["Cooling", "Brite Tank", "Conditioning"].includes(b.stage));
  const inProgressBatches = batches.filter((b) => b.stage === "Packaged" && remainingVolume(b) > 0);
  const packagedBatches = batches.filter((b) => b.stage === "Packaged" && remainingVolume(b) === 0);

  if (justConfirmedEmail) {
    return <EmailConfirmedScreen onContinue={() => setJustConfirmedEmail(false)} />;
  }

  if (session === undefined) {
    return (
      <div style={{ minHeight: "100vh", background: "#F5F1E4", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <BrewpointLoadingMark />
      </div>
    );
  }

  if (!user) {
    return <AuthScreen inviteToken={inviteToken} />;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F5F1E4",
        fontFamily: "'Inter', sans-serif",
        padding: "0 0 60px",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        input:focus { outline: 1px solid #5C9A3C; }
        button:focus-visible { outline: 2px solid #5C9A3C; outline-offset: 2px; }
      `}</style>

      <style>{`
        button:not(:disabled):active { transform: scale(0.97); }
        button { transition: transform 90ms ease, border-color 0.15s, background 0.15s; }
        @media (prefers-reduced-motion: reduce) {
          button:not(:disabled):active { transform: none; }
        }
        @media print {
          body * { visibility: hidden; }
          .bp-print-sheet, .bp-print-sheet * { visibility: visible; }
          .bp-print-sheet { display: block !important; position: absolute; top: 0; left: 0; width: 100%; padding: 24px; }
        }
        .bp-hamburger-btn { display: none; }
        .bp-sidebar-backdrop { display: none; }
        /* Wide screens: the menu stays put while the page scrolls, and
           scrolls on its own if it's taller than the screen. */
        @media (min-width: 861px) {
          .bp-sidebar {
            position: sticky;
            top: 0;
            align-self: flex-start;
            height: 100vh;
            height: 100dvh;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
          }
        }
        @media (max-width: 860px) {
          .bp-hamburger-btn { display: flex !important; }
          .bp-sidebar {
            position: fixed;
            top: 0;
            left: 0;
            height: 100vh;
            z-index: 96;
            transform: translateX(-100%);
            transition: transform 0.22s ease;
            box-shadow: 4px 0 24px rgba(0,0,0,0.15);
          }
          .bp-sidebar.bp-sidebar-open { transform: translateX(0); }
          .bp-sidebar-backdrop.bp-sidebar-open {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(10,12,11,0.5);
            z-index: 95;
          }
          .bp-main-content { padding-top: calc(env(safe-area-inset-top, 0px) + 64px) !important; }
        }
      `}</style>
      {updateAvailable && (
        <UpdateBanner
          onRefresh={async () => {
            // Installed home-screen apps on iOS can hang onto a cached copy
            // even when the server says not to — this throws everything we
            // can at it: clear any Cache Storage entries (harmless if none
            // exist), confirm a fresh copy is actually fetchable, then force
            // a hard navigation (replace, not href — less likely to resolve
            // from any in-memory/back-forward cache) to a cache-busted URL.
            try {
              if (window.caches) {
                const keys = await caches.keys();
                await Promise.all(keys.map((k) => caches.delete(k)));
              }
            } catch {}
            const url = window.location.pathname + "?v=" + Date.now();
            try {
              await fetch(url, { cache: "no-store" });
            } catch {}
            window.location.replace(url);
          }}
        />
      )}
      {isOffline && <OfflineBanner />}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <button
        className="bp-hamburger-btn"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open menu"
        style={{
          display: "none",
          position: "fixed",
          top: `calc(env(safe-area-inset-top, 0px) + ${14 + (isOffline ? 42 : 0)}px)`,
          left: `calc(env(safe-area-inset-left, 0px) + 14px)`,
          zIndex: 97,
          alignItems: "center",
          justifyContent: "center",
          width: 40,
          height: 40,
          background: "#FFFFFF",
          border: "1px solid #DDE0C8",
          borderRadius: 6,
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
        }}
      >
        <Menu size={18} color="#2A3324" />
      </button>
      <div className={`bp-sidebar-backdrop ${sidebarOpen ? "bp-sidebar-open" : ""}`} onClick={() => setSidebarOpen(false)} />

      <div style={{ display: "flex", minHeight: "100vh" }}>
        <div
          className={`bp-sidebar ${sidebarOpen ? "bp-sidebar-open" : ""}`}
          style={{
            width: 210,
            flexShrink: 0,
            background: "#F5F1E4",
            borderRight: "1px solid #DDE0C8",
            padding: "calc(env(safe-area-inset-top, 0px) + 24px) 14px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 26,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 6px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#5C9A3C" }}>
              <BreworxMark size={26} />
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Brewpoint
              </span>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="bp-hamburger-btn"
              aria-label="Close menu"
              style={{ display: "none", background: "none", border: "none", color: "#5C6B54", cursor: "pointer", padding: 4 }}
            >
              <X size={18} />
            </button>
          </div>

          <button
            data-tour="search-btn"
            onClick={() => setShowQuickJump(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "#FFFFFF",
              border: "1px solid #DDE0C8",
              borderRadius: 5,
              padding: "8px 10px",
              color: "#9BA88A",
              fontFamily: "'Inter', sans-serif",
              fontSize: 12.5,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <Search size={13} /> Search…
          </button>

          <button
            data-tour="help-guide-btn"
            onClick={() => setShowHelpGuide(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "none",
              border: "1px solid #DDE0C8",
              borderRadius: 5,
              padding: "8px 10px",
              color: "#9BA88A",
              fontFamily: "'Inter', sans-serif",
              fontSize: 12.5,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <Info size={13} /> Help guide
          </button>

          <button
            onClick={() => setShowAiHelper(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "none",
              border: "1px solid #DDE0C8",
              borderRadius: 5,
              padding: "8px 10px",
              color: "#9BA88A",
              fontFamily: "'Inter', sans-serif",
              fontSize: 12.5,
              cursor: "pointer",
              textAlign: "left",
              marginBottom: 16,
            }}
          >
            <Sparkles size={13} /> Ask AI
          </button>

          <div data-tour="nav-groups" style={{ display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
            {[
              { items: [["home", "Home", Home]] },
              {
                label: "Production",
                items: [
                  ["batches", "Batches", Droplet],
                  ["packaged", "Packaged Batches", Package],
                  ["production", "Production", Calendar],
                  ["brewPlanner", "Brew planner", TrendingUp],
                  barrelAgingModuleEnabled && ["aging", "Aging", Warehouse],
                  ["yeast", "Yeast", FlaskConical],
                  ["brewery", "Brewery", Warehouse],
                ].filter(Boolean),
              },
              {
                label: "Recipes",
                items: [
                  ["recipes", "Recipes", Beaker],
                  // Recipe Builder hidden from nav for now — the view and
                  // its code are untouched, just re-add this line to bring
                  // it back: ["recipeBuilder", "Recipe Builder", FlaskConical],
                  ["recipeAnalytics", "Recipe Analytics", TrendingUp],
                ],
              },
              {
                label: "Quality",
                items: [["quality", "Quality Control", CheckCircle2]],
              },
              {
                label: "Cider",
                items: [["cider", "Cider", Droplet]],
              },
              salesModuleEnabled && {
                label: "Sales",
                items: [
                  ["customers", "Customers", Users],
                  ["salesOrders", "Orders", Truck],
                  ["salesAnalytics", "Analytics", TrendingUp],
                  ["kegs", "Kegs", Box],
                  ["finishedGoodsStock", "Stock", Package],
                ],
              },
              {
                label: "Stock",
                items: [
                  ["inventory", "Inventory", LayoutGrid],
                  ["consumables", "Consumables", Box],
                  ["packageTypes", "Package Types", Layers],
                  ["orders", "Purchase Orders", Truck],
                ],
              },
              {
                label: "Compliance",
                items: [
                  ["foodsafety", "Food Safety", CheckCircle2],
                  ["traceability", "Traceability", Search],
                  isOwner && ["excise", "Excise", FileText],
                ].filter(Boolean),
              },
              { items: [["settings", "Settings", Settings]] },
            ].filter(Boolean).map((group, gi) => (
              <div key={gi} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {group.label && (
                  <div
                    style={{
                      fontFamily: "'Oswald', sans-serif",
                      fontWeight: 500,
                      fontSize: 12.5,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "#5C9A3C",
                      padding: "0 12px",
                      marginBottom: 6,
                    }}
                  >
                    {group.label}
                  </div>
                )}
                {group.items.map(([key, label, Icon]) => {
                  const isCurrent = view === key && !selected && !selectedPO && !selectedRecipe && !selectedInventoryItem && !selectedConsumableItem && !selectedPackageType && !selectedCustomerId && !selectedSalesOrderId;
                  return (
                    <button
                      key={key}
                      data-tour={`nav-${key}`}
                      onClick={() => {
                        setView(key);
                        setSelectedId(null);
                        setSelectedPOId(null);
                        setSelectedRecipeId(null);
                        setSelectedInventoryId(null);
                        setSelectedConsumableId(null);
                        setSelectedPackageTypeId(null);
                        setSelectedCustomerId(null);
                        setSelectedSalesOrderId(null);
                        setSidebarOpen(false);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        textAlign: "left",
                        background: isCurrent ? "#FFFFFF" : "none",
                        border: "none",
                        borderLeft: `2px solid ${isCurrent ? "#5C9A3C" : "transparent"}`,
                        borderRadius: 4,
                        padding: "10px 12px",
                        cursor: "pointer",
                      }}
                    >
                      <Icon size={16} color={isCurrent ? "#5C9A3C" : "#9BA88A"} style={{ flexShrink: 0 }} />
                      <span
                        style={{
                          fontFamily: "'Oswald', sans-serif",
                          fontSize: 15,
                          color: isCurrent ? "#2A3324" : "#5C6B54",
                          fontWeight: 500,
                        }}
                      >
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10, padding: "0 6px" }}>
            <span style={{ color: "#5C6B54", fontSize: 12.5, fontFamily: "'Inter', sans-serif" }}>{user.name}</span>
            <button
              onClick={() => supabase.auth.signOut()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                background: "none",
                border: "1px solid #DDE0C8",
                borderRadius: 4,
                color: "#5C6B54",
                cursor: "pointer",
                padding: "8px 10px",
                fontFamily: "'Inter', sans-serif",
                fontSize: 12.5,
              }}
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </div>

        <div
          className="bp-main-content"
          style={{
            flex: 1,
            minWidth: 0,
            padding: `24px 22px ${60 + (updateAvailable ? 50 : 0)}px`,
            zoom: textScale,
          }}
        >
        {!selected && !selectedPO && !selectedRecipe && !selectedInventoryItem && !selectedConsumableItem && !selectedPackageType && !selectedCustomerId && !selectedSalesOrderId && (
          <div key={view} className="bp-view-fade">
            <style>{`
              @keyframes bp-view-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
              .bp-view-fade { animation: bp-view-fade-in 180ms ease-out; }
              @media (prefers-reduced-motion: reduce) {
                .bp-view-fade { animation: none; }
              }
            `}</style>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
              {view !== "settings" && view !== "home" && view !== "packaged" && view !== "foodsafety" && view !== "recipeBuilder" && view !== "production" && view !== "recipeAnalytics" && view !== "salesAnalytics" && view !== "kegs" && view !== "quality" && view !== "excise" && view !== "cider" && view !== "brewPlanner" && view !== "finishedGoodsStock" && view !== "aging" && view !== "yeast" && view !== "traceability" && (
                <button
                  data-tour={`page-${view}-newbtn`}
                  onClick={() => {
                    if (view === "batches") setShowAdd(true);
                    else if (view === "inventory") setShowAddInventory(true);
                    else if (view === "consumables") setShowAddConsumable(true);
                    else if (view === "packageTypes") setShowAddPackageType(true);
                    else if (view === "orders") setShowAddPO(true);
                    else if (view === "recipes") setShowAddRecipe(true);
                    else if (view === "customers") setShowAddCustomer(true);
                    else if (view === "salesOrders") setShowAddSalesOrder(true);
                    else setShowAddTank(true);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#5C9A3C",
                    border: "none",
                    borderRadius: 5,
                    padding: "9px 14px",
                    color: "#16191A",
                    fontFamily: "'Oswald', sans-serif",
                    fontWeight: 500,
                    fontSize: 13.5,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  <Plus size={16} />{" "}
                  {view === "batches" ? "New batch" : view === "inventory" ? "New item" : view === "consumables" ? "New item" : view === "packageTypes" ? "New package type" : view === "orders" ? "New order" : view === "recipes" ? "New recipe" : view === "customers" ? "New customer" : view === "salesOrders" ? "New order" : "New tank"}
                </button>
              )}
            </div>

            {loadingData && <SkeletonList />}

            {!loadingData && view === "home" && (
              <HomeView
                companyName={companyName}
                companyLogo={companyLogo}
                fermentingBatches={fermentingBatches}
                conditioningBatches={conditioningBatches}
                inProgressBatches={inProgressBatches}
                packagedBatches={packagedBatches}
                inventory={inventory}
                purchaseOrders={purchaseOrders}
                foodSafetyRecords={foodSafetyRecords}
                onOpenBatch={(id) => {
                  setSelectedId(id);
                  setView("batches");
                }}
                onOpenPO={(id) => {
                  setSelectedPOId(id);
                  setView("orders");
                }}
                onGoTo={setView}
                tanks={tanks}
                recipes={recipes}
                totalBatches={batches.length}
                batches={batches}
                consumables={consumables}
                packageTypes={packageTypes}
                recentBatches={recentBatches}
                onQuickLog={setLogTarget}
                activityLog={activityLog}
                onCycleClean={cycleTankClean}
                onSetCleanStage={setTankCleanStage}
                reminders={reminders}
                onAddReminder={addReminder}
                onToggleReminder={toggleReminderDone}
                onReorder={setReorderItem}
              />
            )}

            {!loadingData && view === "packaged" && (
              <PackagedView
                batches={batches}
                onOpenBatch={(id) => {
                  setSelectedId(id);
                  setView("batches");
                }}
              />
            )}

            {!loadingData && view === "foodsafety" && (
              <>
                <FoodSafetyView
                  records={foodSafetyRecords}
                  onStartChecklist={setActiveChecklistTemplate}
                  onStartCalibration={() => setShowCalibrationModal(true)}
                  onStartMaintenance={() => setShowMaintenanceModal(true)}
                  onStartTraining={() => setShowTrainingModal(true)}
                  onStartIllness={() => setShowIllnessModal(true)}
                  onStartNote={(category, title) => setActiveNoteModal({ category, title })}
                  onOpenStaff={setViewingStaffTraining}
                  suppliers={suppliers}
                  onOpenSupplier={setViewingSupplierDocs}
                  onResolveCorrectiveAction={resolveCorrectiveAction}
                  companyName={companyName}
                  onLogPestCheck={() => setShowLogPestCheckModal(true)}
                  onManagePestStations={() => setShowPestStationsModal(true)}
                  pestStations={pestStations}
                  onLogContractorVisit={() => setShowContractorVisitModal(true)}
                  onStartMockRecall={() => setShowMockRecallModal(true)}
                  onStartInternalAudit={() => setShowInternalAuditModal(true)}
                  onLogVerifierVisit={() => setShowVerifierVisitModal(true)}
                  onLogComplaint={() => setShowComplaintModal(true)}
                  onShareWithAuditor={isOwner ? () => setAuditShareScope("foodsafety") : undefined}
                />
              </>
            )}
            {showLogPestCheckModal && (
              <LogPestCheckModal
                stations={pestStations}
                onClose={() => setShowLogPestCheckModal(false)}
                onSave={addFoodSafetyRecord}
                onUploadPhoto={uploadFoodSafetyPhoto}
                onCreateReminder={addReminder}
              />
            )}
            {showPestStationsModal && (
              <PestStationsModal
                stations={pestStations}
                records={foodSafetyRecords}
                onClose={() => setShowPestStationsModal(false)}
                onAdd={addPestStation}
                onUpdate={updatePestStation}
              />
            )}
            {showContractorVisitModal && (
              <LogContractorVisitModal
                onClose={() => setShowContractorVisitModal(false)}
                onSave={addFoodSafetyRecord}
                onUploadPhoto={uploadFoodSafetyPhoto}
              />
            )}
            {showVerifierVisitModal && (
              <LogVerifierVisitModal
                onClose={() => setShowVerifierVisitModal(false)}
                onSave={addFoodSafetyRecord}
                onUploadPhoto={uploadFoodSafetyPhoto}
              />
            )}
            {auditShareScope && <AuditSharesModal scope={auditShareScope} userName={profile?.name} onClose={() => setAuditShareScope(null)} />}
            {showComplaintModal && (
              <LogComplaintModal
                batches={batches}
                onClose={() => setShowComplaintModal(false)}
                onSave={addFoodSafetyRecord}
              />
            )}
            {showMockRecallModal && (
              <MockRecallModal
                inventory={inventory}
                batches={batches}
                salesOrders={salesOrders}
                mixedPackAssemblies={mixedPackAssemblies}
                customers={customers}
                onClose={() => setShowMockRecallModal(false)}
                onSave={addFoodSafetyRecord}
              />
            )}
            {showInternalAuditModal && (
              <InternalAuditModal
                onClose={() => setShowInternalAuditModal(false)}
                onSave={addFoodSafetyRecord}
              />
            )}
            {!loadingData && view === "foodsafety" && !foodSafetyDisclaimerAcceptedAt && (
              <FoodSafetyDisclaimerModal onAccept={acceptFoodSafetyDisclaimer} />
            )}

            {!loadingData && view === "brewPlanner" && brewPlanSettings && (
              <BrewPlannerView
                batches={batches}
                recipes={recipes}
                tanks={tanks}
                salesOrders={salesOrders}
                mixedPackAssemblies={mixedPackAssemblies}
                settings={brewPlanSettings}
                onSaveSettings={saveBrewPlanSettings}
                onSchedule={addBatch}
                nextNumber={nextNumber}
                nextCiderNumber={nextCiderNumber}
              />
            )}

            {!loadingData && view === "cider" && (
              <CiderView
                batches={batches}
                inventory={inventory}
                tanks={tanks}
                nextNumber={nextCiderNumber}
                focus={ciderFocus}
                onCreateBatch={addBatch}
                onSaveCider={saveCiderData}
                onSetBatchFigures={saveCiderData}
                onLogAddition={addBatchIngredient}
                onStartBatch={() => {
                  setBatchPreset({ productType: "Cider/Perry" });
                  setShowAdd(true);
                }}
                onOpenBatch={setSelectedId}
              />
            )}

            {!loadingData && view === "excise" && (
              <ExciseReportView
                batches={batches}
                exciseItemCodes={exciseItemCodes}
                onSaveItemCode={saveExciseItemCode}
                abvMethod={exciseAbvMethod}
                onSetAbvMethod={updateExciseAbvMethod}
                onSetLabelAbv={setBatchLabelAbv}
                recipes={recipes}
                labelStrengths={labelStrengths}
                onSaveLabelStrength={saveLabelStrength}
                onSetDeclared={setExciseDeclared}
                exciseReturns={exciseReturns}
                companyName={companyName}
                onSaveReturn={saveExciseReturn}
                onDeleteReturn={deleteExciseReturn}
                onReviewReturn={reviewExciseReturn}
                onReadScreenshot={readTswScreenshot}
                onImportGroup={importExciseScreenshotGroup}
                onViewScreenshot={viewExciseScreenshot}
                onShareWithAuditor={isOwner ? () => setAuditShareScope("excise") : undefined}
              />
            )}

            {!loadingData && view === "batches" && (() => {
              const matches = (b) => {
                const q = batchQuery.trim().toLowerCase();
                if (!q) return true;
                return b.name.toLowerCase().includes(q) || (b.style || "").toLowerCase().includes(q) || (b.number || "").toLowerCase().includes(q);
              };
              // Scheduled batches haven't started yet, so they don't
              // belong competing for attention at the top — this is meant
              // to be a live view of what's actually fermenting right now.
              const fFerm = fermentingBatches
                .filter(matches)
                .slice()
                .sort((a, b) => (a.startDate > today()) - (b.startDate > today()));
              const fCond = conditioningBatches.filter(matches);
              const fProg = inProgressBatches.filter(matches);
              const fPack = packagedBatches.filter(matches);
              const noMatches = batchQuery.trim() && fFerm.length === 0 && fCond.length === 0 && fProg.length === 0 && fPack.length === 0;
              return (
                <>
                  <input
                    data-tour="page-batches-search"
                    type="text"
                    value={batchQuery}
                    onChange={(e) => setBatchQuery(e.target.value)}
                    placeholder="Search batches by name, style, or number…"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      background: "#F5F1E4",
                      border: "1px solid #DDE0C8",
                      borderRadius: 5,
                      padding: "10px 12px",
                      color: "#2A3324",
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 14,
                      marginBottom: 8,
                    }}
                  />
                  {batches.length > 0 && (
                    <button
                      onClick={() => {
                        const all = [...fFerm, ...fCond, ...fProg, ...fPack];
                        const headers = ["Number", "Name", "Style", "Stage", "Brew date", "Volume (L)", "OG", "FG (latest reading)"];
                        if (isOwner) headers.push("Ingredient cost");
                        headers.push("Tank");
                        downloadCSV(
                          `batches-${today()}.csv`,
                          headers,
                          all.map((b) => {
                            const row = [
                              b.number,
                              b.name,
                              b.style,
                              b.stage,
                              b.startDate,
                              b.volume,
                              b.og != null ? b.og.toFixed(3) : "",
                              latestReading(b).gravity != null ? latestReading(b).gravity.toFixed(3) : "",
                            ];
                            if (isOwner) row.push(b.ingredientCost ?? "");
                            row.push(b.tankName || "");
                            return row;
                          })
                        );
                      }}
                      style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0, marginBottom: 16, display: "block" }}
                    >
                      Export CSV
                    </button>
                  )}
                  <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                    Fermenting ({fFerm.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: (fCond.length || fProg.length || fPack.length) ? 26 : 0 }}>
                    {fFerm.map((b) => (
                      <BatchCard key={b.id} batch={b} onOpen={setSelectedId} tanks={tanks} />
                    ))}
                    {fFerm.length === 0 && !noMatches && (
                      <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>
                        No batches fermenting right now. Start one to get going.
                      </div>
                    )}
                  </div>

                  {fCond.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                        Conditioning ({fCond.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: (fProg.length || fPack.length) ? 26 : 0 }}>
                        {fCond.map((b) => (
                          <BatchCard key={b.id} batch={b} onOpen={setSelectedId} tanks={tanks} />
                        ))}
                      </div>
                    </>
                  )}

                  {fProg.length > 0 && (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#D4A24C", marginBottom: 10 }}>
                        <Package size={12} /> Packaging in progress ({fProg.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: fPack.length ? 26 : 0 }}>
                        {fProg.map((b) => (
                          <BatchCard key={b.id} batch={b} onOpen={setSelectedId} tanks={tanks} />
                        ))}
                      </div>
                    </>
                  )}

                  {fPack.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                        Packaged ({fPack.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {fPack.map((b) => (
                          <BatchCard key={b.id} batch={b} onOpen={setSelectedId} tanks={tanks} />
                        ))}
                      </div>
                    </>
                  )}

                  {noMatches && (
                    <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>No batches match "{batchQuery}".</div>
                  )}
                </>
              );
            })()}

            {!loadingData && view === "inventory" && (() => {
              const filtered = inventory.filter((it) =>
                it.name.toLowerCase().includes(inventoryQuery.trim().toLowerCase())
              );
              const grouped = CATEGORIES.map((cat) => ({
                category: cat,
                items: filtered.filter((it) => it.category === cat),
              })).filter((g) => g.items.length > 0);
              const totalValue = filtered.reduce((sum, it) => sum + inventoryItemValue(it), 0);

              return (
                <>
                  {isOwner && totalValue > 0 && (
                    <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px", marginBottom: 12 }}>
                      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>
                        {inventoryQuery.trim() ? "Value of matching ingredients" : "Total ingredient value"}
                      </div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, color: "#2A3324" }}>${totalValue.toFixed(2)}</div>
                      <div style={{ color: "#9BA88A", fontSize: 11, marginTop: 2 }}>
                        Based on what's still in stock, at what it actually cost per lot — a rough figure, not a formal stocktake valuation.
                      </div>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    <button
                      data-tour="page-inventory-stocktake"
                      onClick={() => setShowStockTake(true)}
                      style={{
                        flex: 1,
                        background: "#EBE8D6",
                        border: "1px solid #C9D1AC",
                        borderRadius: 5,
                        padding: "9px",
                        color: "#2A3324",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 12.5,
                        cursor: "pointer",
                      }}
                    >
                      Start stock take
                    </button>
                    <button
                      onClick={() => setShowStockTakeHistory(true)}
                      style={{
                        flex: 1,
                        background: "none",
                        border: "1px solid #DDE0C8",
                        borderRadius: 5,
                        padding: "9px",
                        color: "#5C6B54",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 12.5,
                        cursor: "pointer",
                      }}
                    >
                      Past reports ({stockTakes.filter((st) => st.type !== "consumables").length})
                    </button>
                    <button
                      onClick={() => setShowSuppliersModal(true)}
                      style={{
                        flex: 1,
                        background: "none",
                        border: "1px solid #DDE0C8",
                        borderRadius: 5,
                        padding: "9px",
                        color: "#5C6B54",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 12.5,
                        cursor: "pointer",
                      }}
                    >
                      Suppliers ({suppliers.length})
                    </button>
                  </div>
                  <InventoryDuplicatesPanel inventory={inventory} onMerge={mergeInventoryItems} onOpen={setSelectedInventoryId} />
                  <input
                    type="text"
                    value={inventoryQuery}
                    onChange={(e) => setInventoryQuery(e.target.value)}
                    placeholder="Search ingredients…"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      background: "#F5F1E4",
                      border: "1px solid #DDE0C8",
                      borderRadius: 5,
                      padding: "10px 12px",
                      color: "#2A3324",
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 14,
                      marginBottom: 8,
                    }}
                  />
                  <button
                    onClick={() => setShowBulkOpeningStock(true)}
                    style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0, marginBottom: 8, display: "block" }}
                  >
                    Bring in opening stock
                  </button>
                  {inventory.length > 0 && (
                    <button
                      onClick={() =>
                        downloadCSV(
                          `inventory-${today()}.csv`,
                          ["Name", "Category", "Qty", "Unit", "Threshold", "Cost per unit", "Supplier"],
                          filtered.map((it) => [
                            it.name,
                            it.category,
                            it.qty,
                            it.unit,
                            it.threshold,
                            it.costPerUnit ?? "",
                            suppliers.find((s) => s.id === it.supplierId)?.name || "",
                          ])
                        )
                      }
                      style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0, marginBottom: 16, display: "block" }}
                    >
                      Export CSV
                    </button>
                  )}

                  {inventory.some((it) => it.qty <= it.threshold) && (() => {
                    const lowItems = inventory.filter((it) => it.qty <= it.threshold);
                    const bySupplier = {};
                    lowItems.forEach((it) => {
                      const key = it.supplierId || "none";
                      if (!bySupplier[key]) bySupplier[key] = [];
                      bySupplier[key].push(it);
                    });
                    return (
                      <div style={{ marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                        {Object.entries(bySupplier).map(([supplierId, items]) => {
                          const supplier = suppliers.find((s) => s.id === supplierId);
                          return (
                            <div
                              key={supplierId}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: 10,
                                color: "#5C9A3C",
                                fontSize: 12.5,
                                background: "#FCF1DC",
                                border: "1px solid #E3D3A0",
                                borderRadius: 5,
                                padding: "8px 12px",
                              }}
                            >
                              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                                <span>
                                  {items.length} item{items.length !== 1 ? "s" : ""} low
                                  {supplier ? ` from ${supplier.name}` : ""}
                                  {supplier?.leadTimeDays ? ` — usually ${supplier.leadTimeDays}d lead time` : ""}
                                </span>
                              </span>
                              {supplier && (
                                <button
                                  onClick={() => createReorderPO(supplier.name, items)}
                                  style={{ background: "#5C9A3C", border: "none", borderRadius: 4, padding: "6px 10px", color: "#16191A", fontFamily: "'Inter', sans-serif", fontSize: 11.5, cursor: "pointer", flexShrink: 0 }}
                                >
                                  Create PO
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {grouped.map((g, i) => (
                    <div key={g.category} style={{ marginBottom: i < grouped.length - 1 ? 22 : 0 }}>
                      <div
                        style={{
                          fontSize: 11,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          color: CATEGORY_COLOR[g.category],
                          marginBottom: 10,
                        }}
                      >
                        {g.category} ({g.items.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {g.items.map((it) => (
                          <InventoryItemCard key={it.id} item={it} onAdjust={adjustInventory} onOpen={setSelectedInventoryId} suppliers={suppliers} isOwner={isOwner} />
                        ))}
                      </div>
                    </div>
                  ))}

                  {filtered.length === 0 && (
                    inventory.length === 0 ? (
                      <EmptyState
                        icon={Package}
                        title="No ingredients tracked yet"
                        subtitle="Already have stock on hand from before you started using this? Bring it all in at once below. Otherwise, add a single ingredient, or receive some in via a purchase order."
                        action={{ label: "Add ingredient", onClick: () => setShowAddInventory(true) }}
                        secondaryAction={{ label: "Bring in opening stock", onClick: () => setShowBulkOpeningStock(true) }}
                      />
                    ) : (
                      <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>No ingredients match "{inventoryQuery}".</div>
                    )
                  )}
                </>
              );
            })()}

            {!loadingData && view === "consumables" && (() => {
              const filtered = consumables.filter((it) =>
                it.name.toLowerCase().includes(consumableQuery.trim().toLowerCase())
              );
              const grouped = CONSUMABLE_CATEGORIES.map((cat) => ({
                category: cat,
                items: filtered.filter((it) => it.category === cat),
              })).filter((g) => g.items.length > 0);
              const totalValue = filtered.reduce((sum, it) => sum + inventoryItemValue(it), 0);

              return (
                <>
                  {isOwner && totalValue > 0 && (
                    <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px", marginBottom: 12 }}>
                      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>
                        {consumableQuery.trim() ? "Value of matching consumables" : "Total consumables value"}
                      </div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, color: "#2A3324" }}>${totalValue.toFixed(2)}</div>
                      <div style={{ color: "#9BA88A", fontSize: 11, marginTop: 2 }}>
                        Based on what's still in stock at its most recent cost — a rough figure, not a formal stocktake valuation.
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => setShowBulkOpeningStockConsumables(true)}
                    style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0, marginBottom: 8, display: "block" }}
                  >
                    Bring in opening stock
                  </button>
                  <input
                    type="text"
                    value={consumableQuery}
                    onChange={(e) => setConsumableQuery(e.target.value)}
                    placeholder="Search consumables…"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      background: "#F5F1E4",
                      border: "1px solid #DDE0C8",
                      borderRadius: 5,
                      padding: "10px 12px",
                      color: "#2A3324",
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 14,
                      marginBottom: 16,
                    }}
                  />

                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    <button
                      data-tour="page-consumables-stocktake"
                      onClick={() => setShowConsumablesStockTake(true)}
                      style={{
                        flex: 1,
                        background: "#EBE8D6",
                        border: "1px solid #C9D1AC",
                        borderRadius: 5,
                        padding: "9px",
                        color: "#2A3324",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 12.5,
                        cursor: "pointer",
                      }}
                    >
                      Start stock take
                    </button>
                    <button
                      onClick={() => setShowConsumablesStockTakeHistory(true)}
                      style={{
                        flex: 1,
                        background: "none",
                        border: "1px solid #DDE0C8",
                        borderRadius: 5,
                        padding: "9px",
                        color: "#5C6B54",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 12.5,
                        cursor: "pointer",
                      }}
                    >
                      Past reports ({stockTakes.filter((st) => st.type === "consumables").length})
                    </button>
                  </div>

                  {consumables.some((it) => it.qty <= it.threshold) && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        color: "#5C9A3C",
                        fontSize: 12.5,
                        marginBottom: 14,
                        background: "#FCF1DC",
                        border: "1px solid #E3D3A0",
                        borderRadius: 5,
                        padding: "8px 12px",
                      }}
                    >
                      <AlertTriangle size={14} />
                      {consumables.filter((it) => it.qty <= it.threshold).length} item(s) running low
                    </div>
                  )}

                  {grouped.map((g, i) => (
                    <div key={g.category} style={{ marginBottom: i < grouped.length - 1 ? 22 : 0 }}>
                      <div
                        style={{
                          fontSize: 11,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          color: CATEGORY_COLOR[g.category],
                          marginBottom: 10,
                        }}
                      >
                        {g.category} ({g.items.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {g.items.map((it) => (
                          <InventoryItemCard key={it.id} item={it} onAdjust={adjustConsumable} onOpen={setSelectedConsumableId} suppliers={suppliers} isOwner={isOwner} />
                        ))}
                      </div>
                    </div>
                  ))}

                  {filtered.length === 0 && (
                    consumables.length === 0 ? (
                      <EmptyState
                        icon={Box}
                        title="No consumables tracked yet"
                        subtitle="Already have cans, lids, boxes, or labels on hand from before you started using this? Bring it all in at once below. Otherwise, add a single item."
                        action={{ label: "Add consumable", onClick: () => setShowAddConsumable(true) }}
                        secondaryAction={{ label: "Bring in opening stock", onClick: () => setShowBulkOpeningStockConsumables(true) }}
                      />
                    ) : (
                      <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>No consumables match "{consumableQuery}".</div>
                    )
                  )}
                </>
              );
            })()}

            {!loadingData && view === "packageTypes" && (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {packageTypes.map((pt) => (
                    <PackageTypeCard key={pt.id} packageType={pt} onOpen={setSelectedPackageTypeId} />
                  ))}
                </div>
                {packageTypes.length === 0 && (
                  <EmptyState icon={Layers} title="No package types yet" subtitle="Create one to define which cans, lids, boxes, or labels get used up each time you package a batch." action={{ label: "New package type", onClick: () => setShowAddPackageType(true) }} />
                )}
              </>
            )}

            {!loadingData && view === "customers" && !selectedCustomerId && (
              <CustomersView customers={customers} onOpen={setSelectedCustomerId} onImportXero={xeroConnection ? openXeroContactImport : undefined} />
            )}

            {!loadingData && view === "salesOrders" && !selectedSalesOrderId && (
              <SalesOrdersView salesOrders={salesOrders} customers={customers} onOpen={setSelectedSalesOrderId} />
            )}

            {!loadingData && view === "salesAnalytics" && (
              <SalesAnalyticsView salesOrders={salesOrders} customers={customers} batches={batches} isOwner={isOwner} />
            )}

            {!loadingData && view === "kegs" && !selectedKegId && (
              <KegsView kegs={kegs} onOpen={(k) => setSelectedKegId(k.id)} onAddNew={() => setShowAddKegs(true)} />
            )}

            {!loadingData && view === "kegs" && selectedKegId && kegs.find((k) => k.id === selectedKegId) && (
              <KegDetail
                keg={kegs.find((k) => k.id === selectedKegId)}
                batches={batches}
                customers={customers}
                onBack={() => setSelectedKegId(null)}
                onFill={fillKeg}
                onSend={sendKeg}
                onReturn={returnKeg}
                onMarkLost={markKegLost}
                onDelete={isOwner ? setDeleteKegTarget : undefined}
              />
            )}

            {!loadingData && view === "finishedGoodsStock" && (
              <FinishedGoodsStockView
                availableStock={availableStock}
                onStartStockTake={() => setShowFinishedStockTake(true)}
                onOpenHistory={() => setShowFinishedStockTakeHistory(true)}
                stockTakeCount={stockTakes.filter((st) => st.type === "finished_stock").length}
                mixedPackTypes={mixedPackTypes}
                mixedPackStock={mixedPackStock}
                onNewMixedPackType={() => setShowNewMixedPackType(true)}
                onEditMixedPackType={setEditingMixedPackType}
                onAssembleMixedPack={setAssemblingMixedPackType}
                batches={batches}
                onClearStock={() => setShowClearStock(true)}
                onUndoClear={undoStockClear}
                onCompareXero={xeroConnection ? openXeroStockCompare : undefined}
                xeroNeedsReconnect={xeroNeedsReconnect}
              />
            )}
            {showClearStock && (
              <ClearStockModal availableStock={availableStock} batches={batches} onClose={() => setShowClearStock(false)} onConfirm={clearPackagedStock} />
            )}
            {(showNewMixedPackType || editingMixedPackType) && (
              <MixedPackTypeModal
                products={[...new Map(availableStock.filter((s) => s.packaged > 0).map((s) => [`${s.batchName}::${s.containerKey}`, { key: `${s.batchName}::${s.containerKey}`, label: `${s.batchName} — ${s.containerLabel}`, batchName: s.batchName, containerKey: s.containerKey, containerLabel: s.containerLabel }])).values()]}
                editingType={editingMixedPackType}
                onClose={() => {
                  setShowNewMixedPackType(false);
                  setEditingMixedPackType(null);
                }}
                onSave={saveMixedPackType}
              />
            )}
            {assemblingMixedPackType && (
              <AssembleMixedPackModal
                mixedPackType={assemblingMixedPackType}
                availableStock={availableStock}
                onClose={() => setAssemblingMixedPackType(null)}
                onSave={(entry) => assembleMixedPack(assemblingMixedPackType, entry)}
              />
            )}

            {!loadingData && view === "orders" && (() => {
              const q = poQuery.trim().toLowerCase();
              const matchesPO = (po) => !q || po.poNumber.toLowerCase().includes(q) || po.supplier.toLowerCase().includes(q);
              const draftPOs = purchaseOrders.filter((po) => po.status === "Draft" && matchesPO(po));
              const sentPOs = purchaseOrders.filter((po) => po.status === "Sent" && matchesPO(po));
              const receivedPOs = purchaseOrders.filter((po) => po.status === "Received" && matchesPO(po));
              const noMatches = q && draftPOs.length === 0 && sentPOs.length === 0 && receivedPOs.length === 0;
              return (
                <>
                  {purchaseOrders.length > 0 && (
                    <input
                      type="text"
                      value={poQuery}
                      onChange={(e) => setPoQuery(e.target.value)}
                      placeholder="Search orders by number or supplier…"
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        background: "#F5F1E4",
                        border: "1px solid #DDE0C8",
                        borderRadius: 5,
                        padding: "10px 12px",
                        color: "#2A3324",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 14,
                        marginBottom: 8,
                      }}
                    />
                  )}
                  {purchaseOrders.length > 0 && (
                    <button
                      onClick={() =>
                        downloadCSV(
                          `purchase-orders-${today()}.csv`,
                          ["PO Number", "Supplier", "Status", "Order date", "Received date", "Delivery cost", "Line count", "Total value"],
                          purchaseOrders.map((po) => [
                            po.poNumber,
                            po.supplier,
                            po.status,
                            po.orderDate,
                            po.receivedDate || "",
                            po.deliveryCost ?? "",
                            po.lines.length,
                            po.lines.reduce((sum, l) => sum + (Number(l.costPerUnit) || 0) * (Number(l.qty) || 0), 0).toFixed(2),
                          ])
                        )
                      }
                      style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0, marginBottom: 16, display: "block" }}
                    >
                      Export CSV
                    </button>
                  )}
                  <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                    Draft ({draftPOs.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: (sentPOs.length || receivedPOs.length) ? 26 : 0 }}>
                    {draftPOs.map((po) => (
                      <POCard key={po.id} po={po} onOpen={setSelectedPOId} />
                    ))}
                    {draftPOs.length === 0 && !noMatches && purchaseOrders.length > 0 && (
                      <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>
                        No drafts. Start a new order to build one out before sending it to a supplier.
                      </div>
                    )}
                  </div>

                  {sentPOs.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                        Sent ({sentPOs.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: receivedPOs.length ? 26 : 0 }}>
                        {sentPOs.map((po) => (
                          <POCard key={po.id} po={po} onOpen={setSelectedPOId} />
                        ))}
                      </div>
                    </>
                  )}

                  {receivedPOs.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                        Received ({receivedPOs.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {receivedPOs.map((po) => (
                          <POCard key={po.id} po={po} onOpen={setSelectedPOId} />
                        ))}
                      </div>
                    </>
                  )}

                  {purchaseOrders.length === 0 && (
                    <EmptyState icon={Truck} title="No purchase orders yet" subtitle="Create one to bring in ingredients with proper lot tracking from day one." action={{ label: "New order", onClick: () => setShowAddPO(true) }} />
                  )}
                  {noMatches && (
                    <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>No orders match "{poQuery}".</div>
                  )}
                </>
              );
            })()}

            {!loadingData && view === "recipes" && (() => {
              const activeByFamily = activeRecipesByFamily(recipes);
              const filtered = activeByFamily.filter(
                (r) =>
                  r.name.toLowerCase().includes(recipeQuery.trim().toLowerCase()) ||
                  r.style.toLowerCase().includes(recipeQuery.trim().toLowerCase())
              );
              return (
                <>
                  {xeroConnection && (
                    <button
                      onClick={openXeroProductMapping}
                      style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0, marginBottom: 10, display: "block" }}
                    >
                      Map recipes to Xero items
                    </button>
                  )}
                  <input
                    data-tour="page-recipes-search"
                    type="text"
                    value={recipeQuery}
                    onChange={(e) => setRecipeQuery(e.target.value)}
                    placeholder="Search recipes by name or style…"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      background: "#F5F1E4",
                      border: "1px solid #DDE0C8",
                      borderRadius: 5,
                      padding: "10px 12px",
                      color: "#2A3324",
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 14,
                      marginBottom: 16,
                    }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {filtered.map((r) => (
                      <RecipeCard key={r.id} recipe={r} onOpen={setSelectedRecipeId} />
                    ))}
                    {filtered.length === 0 && (
                      activeByFamily.length === 0 ? (
                        <EmptyState icon={Beaker} title="No recipes yet" subtitle="Add one so you can pull its ingredients in automatically when you start a brew." action={{ label: "New recipe", onClick: () => setShowAddRecipe(true) }} />
                      ) : (
                        <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>No recipes match "{recipeQuery}".</div>
                      )
                    )}
                  </div>
                </>
              );
            })()}

            {!loadingData && view === "recipeBuilder" && (
              <AddRecipeModal
                standalone
                onClose={() => setView("recipes")}
                onAdd={addRecipe}
                onSaveAndBrew={saveAndBrewRecipe}
                inventory={inventory}
                onAddInventoryItem={addInventoryItem}
              />
            )}

            {!loadingData && view === "recipeAnalytics" && (
              <>
                <RecipeAnalyticsView
                  recipes={recipes}
                  batches={batches}
                  salesOrders={salesOrders}
                  onOpenBatch={(id) => {
                    setSelectedId(id);
                    setView("batches");
                  }}
                  isOwner={isOwner}
                />
              </>
            )}

            {!loadingData && view === "quality" && (
              <QualityControlView
                recipes={recipes}
                batches={batches}
                onOpenBatch={(id) => {
                  setSelectedId(id);
                  setView("batches");
                }}
                onLogTriangleTest={() => setEditingTriangleTest({})}
                triangleTests={triangleTests}
                onOpenTriangleTest={(t) => setEditingTriangleTest(t)}
              />
            )}

            {!loadingData && view === "brewery" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {sortedTanks(tanks).map((t) => {
                  const occupant = occupyingBatch(batches, t.id);
                  return (
                    <div
                      key={t.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        background: "#FFFFFF",
                        border: "1px solid #DDE0C8",
                        borderRadius: 6,
                        padding: "14px 16px",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <h3 style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 16, color: "#2A3324", margin: 0 }}>
                            {t.name}
                          </h3>
                          {t.type === "Brite Tank" && (
                            <span
                              style={{
                                fontFamily: "'JetBrains Mono', monospace",
                                fontSize: 10,
                                letterSpacing: "0.05em",
                                textTransform: "uppercase",
                                color: "#D4A24C",
                                border: "1px solid #E3D3A0",
                                borderRadius: 3,
                                padding: "2px 6px",
                              }}
                            >
                              Brite
                            </span>
                          )}
                        </div>
                        <div style={{ color: "#5C6B54", fontSize: 12.5, marginTop: 3 }}>
                          {t.capacity}L{occupant ? (occupant.startDate > today() ? ` · scheduled: ${occupant.name}` : ` · occupied by ${occupant.name}`) : " · empty"}
                          {t.type === "Barrel" && t.barrelSource ? ` · previously ${t.barrelSource}` : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                        <button
                          data-tour="page-brewery-history"
                          onClick={() => setHistoryTankTarget(t)}
                          aria-label={`History for ${t.name}`}
                          style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 4, color: "#5C6B54", cursor: "pointer", padding: 6 }}
                        >
                          <Calendar size={14} />
                        </button>
                        <button
                          onClick={() => setQrTankTarget(t)}
                          aria-label={`QR code for ${t.name}`}
                          style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 4, color: "#5C6B54", cursor: "pointer", padding: 6 }}
                        >
                          <QrCode size={14} />
                        </button>
                        <button
                          onClick={() => setEditTankTarget(t)}
                          style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 4, color: "#5C6B54", cursor: "pointer", padding: 6 }}
                        >
                          <Settings size={14} />
                        </button>
                        {!occupant && (
                          <button
                            onClick={() => setDeleteTankTarget(t)}
                            style={{ background: "none", border: "1px solid #E3D3A0", borderRadius: 4, color: "#5C9A3C", cursor: "pointer", padding: 6 }}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {tanks.length === 0 && (
                  <EmptyState icon={Droplet} title="No tanks set up yet" subtitle="Add your fermenters and any Brite Tanks so batches can be assigned to them." action={{ label: "Add tank", onClick: () => setShowAddTank(true) }} />
                )}
              </div>
            )}

            {!loadingData && view === "production" && (
              <>
                <ProductionManagerView
                  tanks={tanks}
                  batches={batches}
                  onOpenBatch={(id) => {
                    setSelectedId(id);
                    setView("batches");
                  }}
                  onScheduleTank={(tankId, startDate) => {
                    setBatchPreset({ tankId, startDate });
                    setShowScheduleModal(true);
                  }}
                  onEditScheduled={setEditScheduledBatchId}
                  reminders={reminders}
                  onOpenDay={setActiveReminderDay}
                  recipes={recipes}
                  inventory={inventory}
                  onCheckIngredients={() => setShowIngredientsNeeded(true)}
                  onReschedule={(batch, patch) => updateScheduledBatch(batch.id, { ...batch, ...patch })}
                />
              </>
            )}
            {showIngredientsNeeded && (
              <IngredientsNeededModal
                batches={batches}
                recipes={recipes}
                inventory={inventory}
                onClose={() => setShowIngredientsNeeded(false)}
                onOpenPO={() => {
                  setShowIngredientsNeeded(false);
                  setShowAddPO(true);
                }}
              />
            )}

            {!loadingData && view === "aging" && (
              <AgingOverviewView
                batches={batches}
                tanks={tanks}
                onOpenBatch={(id) => {
                  setSelectedId(id);
                  setView("batches");
                }}
              />
            )}

            {!loadingData && view === "yeast" && (
              <YeastView
                yeastHarvests={yeastHarvests}
                onOpenSourceBatch={(batchId) => {
                  if (!batchId) return;
                  setSelectedId(batchId);
                  setView("batches");
                }}
              />
            )}

            {!loadingData && view === "traceability" && (
              <TraceabilityView
                inventory={inventory}
                batches={batches}
                salesOrders={salesOrders}
                mixedPackAssemblies={mixedPackAssemblies}
                customers={customers}
              />
            )}

            {activeReminderDay && (
              <ReminderDayModal
                date={activeReminderDay}
                reminders={reminders}
                onClose={() => setActiveReminderDay(null)}
                onAdd={addReminder}
                onToggle={toggleReminderDone}
                onDelete={deleteReminder}
              />
            )}

            {!loadingData && view === "settings" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
                <div>
                  <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                    Account
                  </div>
                  <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>Name</div>
                      <div style={{ color: "#2A3324", fontSize: 15, marginTop: 2 }}>{user.name}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>Email</div>
                      <div style={{ color: "#2A3324", fontSize: 15, marginTop: 2 }}>{user.email}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>Role</div>
                      <div style={{ color: "#2A3324", fontSize: 15, marginTop: 2, textTransform: "capitalize" }}>{profile?.role || "—"}</div>
                    </div>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                    Display
                  </div>
                  <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px" }}>
                    <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                      Text size
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {[["1", "Normal"], ["1.15", "Large"], ["1.3", "Extra large"]].map(([val, label]) => (
                        <button
                          key={val}
                          onClick={() => setTextScalePersist(val)}
                          style={{
                            flex: 1,
                            background: textScale === val ? "#5C9A3C" : "#F5F1E4",
                            border: `1px solid ${textScale === val ? "#5C9A3C" : "#DDE0C8"}`,
                            borderRadius: 5,
                            padding: "9px 10px",
                            color: textScale === val ? "#16191A" : "#5C6B54",
                            fontFamily: "'Inter', sans-serif",
                            fontWeight: textScale === val ? 600 : 400,
                            fontSize: 13,
                            cursor: "pointer",
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => setShowWhatsNew(true)}
                    style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12.5, fontFamily: "'Inter', sans-serif", padding: 0, marginTop: 10 }}
                  >
                    What's new in Brewpoint
                  </button>
                  <button
                    onClick={() => setShowWelcomeTour(true)}
                    style={{ display: "block", background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12.5, fontFamily: "'Inter', sans-serif", padding: 0, marginTop: 8 }}
                  >
                    Take the getting-started tour again
                  </button>
                </div>

                <div>
                  <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                    Modules
                  </div>
                  <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
                    <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, cursor: "pointer" }}>
                      <span>
                        <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 14, color: "#2A3324" }}>Sales & Orders</div>
                        <div style={{ color: "#5C6B54", fontSize: 12, marginTop: 2 }}>
                          Customers and Orders in the sidebar. Turn this off if you sell through something else and don't need it here.
                        </div>
                      </span>
                      <input
                        type="checkbox"
                        checked={salesModuleEnabled}
                        onChange={(e) => toggleSalesModule(e.target.checked)}
                        disabled={!isOwner}
                        style={{ width: 18, height: 18, accentColor: "#5C9A3C", cursor: "pointer", flexShrink: 0 }}
                      />
                    </label>

                    <div style={{ borderTop: "1px solid #EBE8D6" }} />

                    <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, cursor: "pointer" }}>
                      <span>
                        <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 14, color: "#2A3324" }}>Barrel & Aging</div>
                        <div style={{ color: "#5C6B54", fontSize: 12, marginTop: 2 }}>
                          Barrel and Aging Tank types, plus the Aging page. Turn this off if you don't run a barrel or long-term aging program.
                        </div>
                      </span>
                      <input
                        type="checkbox"
                        checked={barrelAgingModuleEnabled}
                        onChange={(e) => toggleBarrelAgingModule(e.target.checked)}
                        disabled={!isOwner}
                        style={{ width: 18, height: 18, accentColor: "#5C9A3C", cursor: "pointer", flexShrink: 0 }}
                      />
                    </label>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                    Company
                  </div>
                  <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px" }}>
                    <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>Name</div>
                    <div style={{ color: "#2A3324", fontSize: 17, fontFamily: "'Oswald', sans-serif", marginTop: 2 }}>{companyName || "—"}</div>
                  </div>
                  <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px", marginTop: 8 }}>
                    <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                      Logo (optional)
                    </div>
                    <div style={{ color: "#5C6B54", fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
                      Upload a logo to show instead of your company name on the Home page. Leave this blank and
                      your company name stays as plain text.
                    </div>
                    {companyLogo && (
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                        <img src={companyLogo} alt="Company logo" style={{ width: 56, height: 56, objectFit: "contain", background: "#F5F1E4", borderRadius: 6, border: "1px solid #DDE0C8" }} />
                        <button
                          onClick={removeCompanyLogo}
                          style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12.5, fontFamily: "'Inter', sans-serif", padding: 0 }}
                        >
                          Remove logo
                        </button>
                      </div>
                    )}
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 7,
                        background: "none",
                        border: "1px dashed #C9D1AC",
                        borderRadius: 5,
                        padding: "9px",
                        color: "#5C6B54",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 12.5,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => uploadCompanyLogo(e.target.files && e.target.files[0])}
                        style={{ display: "none" }}
                      />
                      {companyLogo ? "Replace logo" : "Upload logo"}
                    </label>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                    Xero
                  </div>
                  <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px" }}>
                    {!isOwner ? (
                      <div style={{ color: "#9BA88A", fontSize: 12.5 }}>
                        {xeroConnection ? `Connected to ${xeroConnection.tenant_name}.` : "Not connected."} Only the account owner can manage the Xero connection.
                      </div>
                    ) : xeroConnection ? (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <CheckCircle2 size={15} color="#D9A441" />
                          <span style={{ color: "#2A3324", fontSize: 15, fontFamily: "'Oswald', sans-serif" }}>Connected</span>
                        </div>
                        <div style={{ color: "#5C6B54", fontSize: 12.5, marginBottom: 12 }}>
                          {xeroConnection.tenant_name}
                          {xeroConnection.connected_by ? ` · connected by ${xeroConnection.connected_by}` : ""}
                        </div>

                        <div style={{ borderTop: "1px solid #DDE0C8", paddingTop: 12, marginBottom: 12 }}>
                          <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
                            Stock sync
                          </div>
                          <div style={{ color: "#5C6B54", fontSize: 12, marginBottom: 10, lineHeight: 1.5 }}>
                            Packaging a batch pushes stock into Xero automatically. This needs one account chosen —
                            used only to net the entry to zero, it won't affect your books.
                          </div>
                          {xeroSettings?.adjustment_account_code ? (
                            <div style={{ color: "#D9A441", fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                              <CheckCircle2 size={13} /> Using "{xeroSettings.adjustment_account_name}"
                            </div>
                          ) : xeroAccounts.length > 0 ? (
                            <select
                              onChange={(e) => {
                                const acc = xeroAccounts.find((a) => a.code === e.target.value);
                                if (acc) saveXeroAdjustmentAccount(acc.code, acc.name);
                              }}
                              defaultValue=""
                              style={{
                                width: "100%",
                                boxSizing: "border-box",
                                background: "#F5F1E4",
                                border: "1px solid #DDE0C8",
                                borderRadius: 4,
                                padding: "9px 10px",
                                color: "#2A3324",
                                fontFamily: "'Inter', sans-serif",
                                fontSize: 13,
                              }}
                            >
                              <option value="" disabled>
                                Choose an account…
                              </option>
                              {xeroAccounts.map((a) => (
                                <option key={a.code} value={a.code}>
                                  {a.name} ({a.code})
                                </option>
                              ))}
                            </select>
                          ) : (
                            <button
                              onClick={loadXeroAccounts}
                              style={{ background: "#EBE8D6", border: "1px solid #C9D1AC", borderRadius: 5, padding: "9px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer", width: "100%" }}
                            >
                              Load accounts from Xero
                            </button>
                          )}
                        </div>

                        <div style={{ borderTop: "1px solid #DDE0C8", paddingTop: 12, marginBottom: 12 }}>
                          <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
                            Sales from Xero
                          </div>
                          <div style={{ color: "#5C6B54", fontSize: 12, marginBottom: 10, lineHeight: 1.5 }}>
                            Invoices you raise in Xero take the beer off Brewpoint's stock, and voiding one puts it back. Brewpoint checks every 10 minutes while it's open.
                            Invoices made from Brewpoint orders are skipped — those orders already took the stock off.
                          </div>
                          {xeroNeedsReconnect && (
                            <div style={{ background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 5, padding: "8px 10px", color: "#7A3E1D", fontSize: 12.5, marginBottom: 10, lineHeight: 1.5 }}>
                              Xero has disconnected (it does this if the link isn't used for 60 days), so sales aren't coming through. Disconnect and connect Xero again above.
                            </div>
                          )}
                          {xeroSettings?.sales_sync_enabled ? (
                            <>
                              <div style={{ color: "#D9A441", fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                <CheckCircle2 size={13} /> On — counting invoices dated from {xeroSettings.sales_sync_from ? new Date(`${xeroSettings.sales_sync_from}T00:00:00`).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : "today"}
                              </div>
                              <div style={{ color: "#9BA88A", fontSize: 11.5, marginBottom: 10 }}>
                                {xeroSettings.last_sales_sync ? `Last checked ${new Date(xeroSettings.last_sales_sync).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : "Not checked yet"}
                                {` · ${xeroSalesMap.filter((m) => !m.ignore).length} Xero item${xeroSalesMap.filter((m) => !m.ignore).length === 1 ? "" : "s"} matched`}
                              </div>
                              {xeroUnmatched.length > 0 && (
                                <div style={{ background: "#FBF3DC", border: "1px solid #E3D3A0", borderRadius: 5, padding: "8px 10px", color: "#8A6D0B", fontSize: 12, marginBottom: 10, lineHeight: 1.45 }}>
                                  Sold in Xero but not matched to a beer yet: {xeroUnmatched.join(", ")}. Match them and they'll come off stock on the next check.
                                </div>
                              )}
                              <XeroHistoryImport before={xeroSettings.sales_sync_from || today()} onImport={importXeroSalesHistory} />
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <button
                                  onClick={() => syncSalesFromXero(false)}
                                  disabled={xeroSalesSyncing}
                                  style={{ flex: "1 1 140px", background: "#5C9A3C", border: "none", borderRadius: 5, padding: "9px", color: "#16191A", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: xeroSalesSyncing ? "default" : "pointer", opacity: xeroSalesSyncing ? 0.6 : 1 }}
                                >
                                  {xeroSalesSyncing ? "Checking…" : "Check Xero now"}
                                </button>
                                <button
                                  onClick={openXeroStockCompare}
                                  style={{ flex: "1 1 140px", background: "#EBE8D6", border: "1px solid #C9D1AC", borderRadius: 5, padding: "9px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
                                >
                                  Compare stock with Xero
                                </button>
                                <button
                                  onClick={() => setShowSameBeer(true)}
                                  style={{ flex: "1 1 140px", background: "#EBE8D6", border: "1px solid #C9D1AC", borderRadius: 5, padding: "9px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
                                >
                                  Same beer, different names
                                </button>
                                <button
                                  onClick={openXeroItemMatch}
                                  style={{ flex: "1 1 140px", background: "#EBE8D6", border: "1px solid #C9D1AC", borderRadius: 5, padding: "9px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
                                >
                                  Match Xero items
                                </button>
                                <button
                                  onClick={() => setXeroSalesSync(false)}
                                  style={{ flex: "1 1 100%", background: "none", border: "none", padding: "6px", color: "#9BA88A", fontFamily: "'Inter', sans-serif", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
                                >
                                  Turn off
                                </button>
                              </div>
                            </>
                          ) : (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button
                                onClick={openXeroItemMatch}
                                style={{ flex: "1 1 140px", background: "#EBE8D6", border: "1px solid #C9D1AC", borderRadius: 5, padding: "9px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
                              >
                                1. Match Xero items
                              </button>
                              <button
                                onClick={() => setXeroSalesSync(true)}
                                style={{ flex: "1 1 140px", background: "#5C9A3C", border: "none", borderRadius: 5, padding: "9px", color: "#16191A", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
                              >
                                2. Turn on from today
                              </button>
                            </div>
                          )}
                        </div>

                        <button
                          onClick={disconnectXero}
                          style={{ background: "none", border: "1px solid #E3D3A0", borderRadius: 5, padding: "9px", color: "#5C9A3C", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer", width: "100%" }}
                        >
                          Disconnect
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={{ color: "#5C6B54", fontSize: 12.5, marginBottom: 12, lineHeight: 1.5 }}>
                          Connect Brewpoint to your Xero account. This is step one of the integration — stock
                          syncing comes next once this connection is confirmed working.
                        </div>
                        <button
                          onClick={() => {
                            setXeroConnecting(true);
                            window.location.href = buildXeroAuthUrl(profile.companyId);
                          }}
                          disabled={xeroConnecting}
                          style={{
                            background: "#13B5EA",
                            border: "none",
                            borderRadius: 5,
                            padding: "10px",
                            color: "#0B2E3A",
                            fontFamily: "'Oswald', sans-serif",
                            fontWeight: 500,
                            fontSize: 14,
                            cursor: "pointer",
                            width: "100%",
                          }}
                        >
                          {xeroConnecting ? "Redirecting to Xero…" : "Connect to Xero"}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                    <Users size={13} /> Team ({teammates.length})
                  </div>
                  {profile?.role === "owner" && (
                    <div style={{ marginBottom: 10 }}>
                      {!inviteLink ? (
                        <button
                          onClick={createInvite}
                          disabled={creatingInvite}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 7,
                            width: "100%",
                            background: "none",
                            border: "1px dashed #C9D1AC",
                            borderRadius: 5,
                            padding: "10px",
                            color: "#5C6B54",
                            fontFamily: "'Inter', sans-serif",
                            fontSize: 13,
                            cursor: creatingInvite ? "default" : "pointer",
                          }}
                        >
                          <Plus size={14} /> {creatingInvite ? "Creating link…" : "Invite a teammate"}
                        </button>
                      ) : (
                        <div style={{ background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, padding: "10px 12px" }}>
                          <div style={{ color: "#5C6B54", fontSize: 11.5, marginBottom: 6 }}>
                            Share this link — it works once, for one person, and only for your company.
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <input
                              readOnly
                              value={inviteLink}
                              onFocus={(e) => e.target.select()}
                              style={{
                                flex: 1,
                                minWidth: 0,
                                background: "#FFFFFF",
                                border: "1px solid #DDE0C8",
                                borderRadius: 4,
                                padding: "8px 10px",
                                color: "#2A3324",
                                fontFamily: "'JetBrains Mono', monospace",
                                fontSize: 11.5,
                              }}
                            />
                            <button
                              onClick={() => {
                                navigator.clipboard?.writeText(inviteLink);
                                showToast("success", "Link copied.");
                              }}
                              style={{ background: "#5C9A3C", border: "none", borderRadius: 4, padding: "0 12px", color: "#16191A", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
                            >
                              Copy
                            </button>
                          </div>
                          <button
                            onClick={() => setInviteLink("")}
                            style={{ background: "none", border: "none", color: "#9BA88A", fontFamily: "'Inter', sans-serif", fontSize: 11.5, cursor: "pointer", padding: "6px 0 0" }}
                          >
                            Done
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {teammates.map((t) => (
                      <div
                        key={t.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "10px 14px",
                          background: "#F8F5EA",
                          border: "1px solid #EBE8D6",
                          borderRadius: 5,
                          fontSize: 13.5,
                        }}
                      >
                        <span style={{ color: "#2A3324" }}>
                          {t.name}
                          {t.id === user.id ? " (you)" : ""}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {t.createdAt && (
                            <span style={{ color: "#9BA88A", fontSize: 11 }}>Joined {t.createdAt.slice(0, 10)}</span>
                          )}
                          {profile?.role === "owner" && t.id !== user.id ? (
                            <button
                              onClick={() => updateTeammateRole(t, t.role === "owner" ? "member" : "owner")}
                              style={{
                                fontFamily: "'JetBrains Mono', monospace",
                                color: "#5C9A3C",
                                fontSize: 11,
                                textTransform: "uppercase",
                                background: "none",
                                border: "1px solid #C9D1AC",
                                borderRadius: 10,
                                padding: "2px 8px",
                                cursor: "pointer",
                              }}
                            >
                              {t.role} — tap to {t.role === "owner" ? "make member" : "make owner"}
                            </button>
                          ) : (
                            <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 11, textTransform: "uppercase" }}>
                              {t.role}
                            </span>
                          )}
                          {profile?.role === "owner" && t.id !== user.id && (
                            <button
                              onClick={() => removeTeammate(t)}
                              aria-label={`Remove ${t.name}`}
                              style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 4 }}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ color: "#9BA88A", fontSize: 12, marginTop: 10 }}>
                    {profile?.role === "owner"
                      ? "Generate an invite link above to add someone — signing up on its own always creates a brand-new company now."
                      : "Only the account owner can invite new teammates."}
                  </div>
                </div>

                {isOwner && (
                  <button
                    onClick={() =>
                      downloadJSON(`brewpoint-backup-${today()}.json`, {
                        exportedAt: new Date().toISOString(),
                        company: companyName,
                        batches,
                        recipes,
                        inventory,
                        consumables,
                        packageTypes,
                        purchaseOrders,
                        tanks,
                        suppliers,
                        foodSafetyRecords,
                      })
                    }
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 7,
                      background: "none",
                      border: "1px solid #DDE0C8",
                      borderRadius: 5,
                      padding: "12px",
                      color: "#5C6B54",
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 13.5,
                      cursor: "pointer",
                    }}
                  >
                    <FileText size={15} /> Download full backup
                  </button>
                )}

                {isOwner && (
                  <button
                    onClick={() => setShowAiFeedbackReview(true)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 7,
                      background: "none",
                      border: "1px solid #DDE0C8",
                      borderRadius: 5,
                      padding: "12px",
                      color: "#5C6B54",
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 13.5,
                      cursor: "pointer",
                    }}
                  >
                    <Sparkles size={15} /> Flagged AI answers{aiFeedback.length > 0 ? ` (${aiFeedback.length})` : ""}
                  </button>
                )}

                <button
                  onClick={() => supabase.auth.signOut()}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 7,
                    background: "none",
                    border: "1px solid #E3D3A0",
                    borderRadius: 5,
                    padding: "12px",
                    color: "#5C9A3C",
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 13.5,
                    cursor: "pointer",
                  }}
                >
                  <LogOut size={15} /> Sign out
                </button>

                <button
                  onClick={() => setShowDeleteAccount(true)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#E3D3A0",
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 12.5,
                    cursor: "pointer",
                    padding: "4px 0",
                  }}
                >
                  Delete account
                </button>

                {profile?.role === "owner" && (
                  <button
                    onClick={() => setShowDeleteCompany(true)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#E3D3A0",
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 12.5,
                      cursor: "pointer",
                      padding: "4px 0",
                    }}
                  >
                    Delete company (removes everything for everyone)
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {selected && (
          <BatchDetail
            batch={selected}
            recipes={recipes}
            allBatches={batches}
            onOpenCiderTools={(batchId, tab) => {
              setCiderFocus({ batchId, tab, key: Date.now() });
              setSelectedId(null);
              setView("cider");
            }}
            onOpenBatch={setSelectedId}
            onConvertSplitTanks={setConvertSplitTarget}
            isOwner={isOwner}
            onBack={() => setSelectedId(null)}
            onAdvance={advance}
            onMoveBack={moveStageBack}
            onLogReading={(batch, tankId, tankName) => setLogTarget({ batch, tankId, tankName })}
            onDeleteReading={deleteReading}
            onEditBrewDayField={setBrewDayFieldTarget}
            onOpenPackaging={setPackagingTarget}
            onUndoPackagingEvent={undoPackagingEvent}
            onDiscardRemaining={setDiscardTarget}
            onAssignTank={setAssignTankTarget}
            onToggleScheduleStep={toggleScheduleStep}
            onDeleteBatch={isOwner ? setDeleteBatchTarget : undefined}
            stages={stages}
            onLogDiacetylTest={setDiacetylTestTarget}
            onToggleFault={toggleBatchFault}
            onUploadPhoto={uploadBatchPhoto}
            onDeletePhoto={deleteBatchPhoto}
            onStartTimer={startBrewTimer}
            onStopTimer={stopBrewTimer}
            tanks={tanks}
            onStartRecirculation={setBrewSubStage}
            onOpenVesselTransfer={setVesselTransferTarget}
            onEditSplitTanks={setEditSplitTanksTarget}
            onOpenFermenterTransfer={setFermenterTransferTarget}
            onStartPackaging={setStartPackagingTarget}
            onCancelPackagingRun={cancelPackagingRun}
            onSetCarbonationChecked={setCarbonationChecked}
            onSetBrewDayCheckbox={setBrewDayCheckbox}
            onAddNote={addBatchNote}
            onDeleteNote={deleteBatchNote}
            onOpenTastingLog={() => setShowTastingLog(true)}
            onOpenSensoryScore={() => setShowSensoryScore(true)}
            onOpenQcApproval={() => setShowQcApproval(true)}
            onOpenLabMeasurement={() => setShowLabMeasurement(true)}
            onSetStillFermenting={setStillFermenting}
            onUpdateTankSettings={updateTankSettings}
            onLogDump={logDump}
            onUndoDump={undoDump}
            onOpenTopUp={() => setShowTopUp(true)}
            yeastHarvests={yeastHarvests}
            onOpenHarvestYeast={() => setShowHarvestYeast(true)}
            onAddSplitTankIngredient={setAddingIngredientToTank}
            onAddBatchIngredient={() => setShowAddBatchIngredient(true)}
            onAddBrewDay={() => setShowAddBrewDay(true)}
          />
        )}
        {showTastingLog && selected && (
          <TastingLogModal
            onClose={() => setShowTastingLog(false)}
            onSave={(entry) => addTastingNote(selected.id, entry)}
          />
        )}
        {showSensoryScore && selected && (
          <SensoryScoreModal
            onClose={() => setShowSensoryScore(false)}
            onSave={(entry) => addSensoryScore(selected.id, entry)}
          />
        )}
        {showQcApproval && selected && (
          <QcApprovalModal
            onClose={() => setShowQcApproval(false)}
            onSave={(approval) => saveQcApproval(selected.id, approval)}
          />
        )}
        {showLabMeasurement && selected && (
          <LabMeasurementModal
            onClose={() => setShowLabMeasurement(false)}
            onSave={(entry) => addLabMeasurement(selected.id, entry)}
          />
        )}
        {showTopUp && selected && (
          <TopUpModal
            onClose={() => setShowTopUp(false)}
            onSave={(entry) => addVolumeTopup(selected.id, entry)}
          />
        )}
        {showAddBrewDay && selected && (
          <AddBrewDayModal
            onClose={() => setShowAddBrewDay(false)}
            onSave={(entry) => addBrewDay(selected.id, entry)}
            mergeableBatches={batches.filter(
              (b) => b.stage === "Brewing" && b.id !== selected.id && !b.mergedIntoBatchId && b.startDate <= today()
            )}
            onMerge={(sourceBatchId) => mergeBatchAsBrewDay(selected.id, sourceBatchId)}
            onStartNewToMerge={() => {
              const dayNumber = (selected.brewDays || []).length + 2;
              setBatchPreset({ name: `${selected.name} — brew day ${dayNumber}` });
              setBrewRecipe(selected.recipeId ? recipes.find((r) => r.id === selected.recipeId) || null : null);
              setShowAddBrewDay(false);
              setShowAdd(true);
            }}
          />
        )}
        {showHarvestYeast && selected && (
          <HarvestYeastModal
            defaultStrainName={
              selected.ingredients && selected.ingredients.find((i) => i.category === "Yeast")
                ? selected.ingredients.find((i) => i.category === "Yeast").name
                : ""
            }
            onClose={() => setShowHarvestYeast(false)}
            onSave={(entry) => harvestYeast(selected, entry)}
          />
        )}
        {addingIngredientToTank && selected && (
          <AddSplitTankIngredientModal
            tankName={addingIngredientToTank.tankName}
            inventory={inventory}
            onClose={() => setAddingIngredientToTank(null)}
            onSave={(entry) => addSplitTankIngredient(selected.id, addingIngredientToTank.tankId, entry)}
          />
        )}
        {showAddBatchIngredient && selected && (
          <AddSplitTankIngredientModal
            tankName={selected.name}
            inventory={inventory}
            onClose={() => setShowAddBatchIngredient(false)}
            onSave={(entry) => addBatchIngredient(selected.id, entry)}
          />
        )}

        {!selected && selectedPO && (
          <PODetail po={selectedPO} onBack={() => setSelectedPOId(null)} onMarkSent={markPOSent} onReceive={receivePO} onReceiveMultiple={receiveMultiplePOs} inventory={inventory} onDelete={isOwner ? deletePO : undefined} onExtractDocument={extractDocument} onEdit={setEditingPO} allPOs={purchaseOrders} />
        )}

        {!selected && !selectedPO && selectedRecipe && (
          <RecipeDetail
            recipe={selectedRecipe}
            inventory={inventory}
            onBack={() => setSelectedRecipeId(null)}
            onBrew={(recipe) => {
              setBrewRecipe(recipe);
              setSelectedRecipeId(null);
              setShowAdd(true);
            }}
            onDelete={isOwner ? setDeleteRecipeTarget : undefined}
            versions={recipes
              .filter((r) => r.familyId === selectedRecipe.familyId)
              .sort((a, b) => (b.version || 1) - (a.version || 1))}
            onSwitchVersion={setSelectedRecipeId}
            onEdit={setEditRecipeTarget}
            onSetActive={setActiveRecipeVersion}
            onScale={setScaleRecipeTarget}
            onCheckIngredients={checkRecipeIngredients}
          />
        )}

        {missingIngredientsPrompt && (
          <MissingIngredientsModal
            missing={missingIngredientsPrompt.missing}
            sourceLabel={missingIngredientsPrompt.sourceLabel}
            inventory={inventory}
            onClose={() => setMissingIngredientsPrompt(null)}
            onAdd={addInventoryItem}
            onMatch={(oldName, matchedItem) => matchRecipeIngredient(missingIngredientsPrompt.recipeId, oldName, matchedItem)}
          />
        )}

        {!selected && !selectedPO && !selectedRecipe && !selectedCustomerId && !selectedSalesOrderId && selectedInventoryItem && (
          <InventoryItemDetail
            item={selectedInventoryItem}
            onBack={() => setSelectedInventoryId(null)}
            onAdjust={adjustInventory}
            onLogAdjustment={setAdjustTarget}
            suppliers={suppliers}
            onChangeSupplier={updateInventorySupplier}
            onDelete={isOwner ? deleteInventoryItem : undefined}
            onRename={renameInventoryItem}
            canChangeUnit
            mergeCandidates={inventory.filter((it) => it.id !== selectedInventoryItem.id)}
            onMerge={mergeInventoryItems}
            onAddLot={addManualLot}
            categories={CATEGORIES}
            onEditDetails={updateInventoryItemDetails}
            onDeleteHistoryEntry={isOwner ? deleteInventoryHistoryEntry : undefined}
          />
        )}

        {!selected && !selectedPO && !selectedRecipe && !selectedInventoryItem && !selectedCustomerId && !selectedSalesOrderId && selectedConsumableItem && (
          <InventoryItemDetail
            item={selectedConsumableItem}
            onBack={() => setSelectedConsumableId(null)}
            onAdjust={adjustConsumable}
            onLogAdjustment={setConsumableAdjustTarget}
            suppliers={suppliers}
            onChangeSupplier={updateConsumableSupplier}
            backLabel="All consumables"
            showCost
            onChangeCost={updateConsumableCost}
            onDelete={isOwner ? deleteConsumable : undefined}
            onRename={renameConsumable}
            categories={CONSUMABLE_CATEGORIES}
            onEditDetails={updateConsumableDetails}
            onDeleteHistoryEntry={isOwner ? deleteConsumableHistoryEntry : undefined}
          />
        )}

        {!selected && !selectedPO && !selectedRecipe && !selectedInventoryItem && !selectedConsumableItem && !selectedCustomerId && !selectedSalesOrderId && selectedPackageType && (
          <PackageTypeDetail
            packageType={selectedPackageType}
            consumables={consumables}
            onBack={() => setSelectedPackageTypeId(null)}
            onDelete={isOwner ? deletePackageType : undefined}
            onRename={renamePackageType}
          />
        )}

        {!selected && !selectedPO && !selectedRecipe && !selectedInventoryItem && !selectedConsumableItem && !selectedPackageType && !selectedSalesOrderId && selectedCustomer && (
          <CustomerDetail
            customer={selectedCustomer}
            onBack={() => setSelectedCustomerId(null)}
            onEdit={() => setEditingCustomer(selectedCustomer)}
            onDelete={isOwner ? () => deleteCustomer(selectedCustomer) : undefined}
            xeroConnected={!!xeroConnection}
            onLinkXero={openXeroContactLink}
            onUnlinkXero={unlinkCustomerFromXero}
            availableStock={availableStock}
            customerPrices={customerPrices}
            onSavePrice={saveCustomerPrice}
            onGeneratePortalLink={generatePortalLink}
            onInviteToOrderOnline={inviteCustomerToOrderOnline}
          />
        )}

        {!selected && !selectedPO && !selectedRecipe && !selectedInventoryItem && !selectedConsumableItem && !selectedPackageType && !selectedCustomerId && selectedSalesOrder && (
          <SalesOrderDetail
            order={selectedSalesOrder}
            customer={customers.find((c) => c.id === selectedSalesOrder.customerId) || null}
            onBack={() => setSelectedSalesOrderId(null)}
            onAdvance={advanceSalesOrderStatus}
            onCancel={cancelSalesOrder}
            onTogglePaid={toggleSalesOrderPaid}
            onDelete={isOwner ? deleteSalesOrder : undefined}
            onRecordFulfillment={setFulfillmentTarget}
            onPrint={setPrintOrderTarget}
          />
        )}
        </div>
      </div>
      {fulfillmentTarget && (
        <RecordFulfillmentModal
          order={fulfillmentTarget}
          onClose={() => setFulfillmentTarget(null)}
          onSave={(fulfillingNowLines, pod, date) => recordFulfillment(fulfillmentTarget.id, fulfillingNowLines, pod, date)}
        />
      )}

      {printOrderTarget && (
        <PrintableOrderModal
          order={printOrderTarget}
          customer={customers.find((c) => c.id === printOrderTarget.customerId) || null}
          companyName={companyName}
          onClose={() => setPrintOrderTarget(null)}
        />
      )}

      {showAddKegs && <AddKegsModal onClose={() => setShowAddKegs(false)} onSave={addKegsBulk} />}

      {editingTriangleTest && (
        <TriangleTestModal
          batches={batches}
          existingTest={editingTriangleTest.id ? editingTriangleTest : null}
          onClose={() => setEditingTriangleTest(null)}
          onSave={saveTriangleTest}
        />
      )}

      {deleteKegTarget && (
        <ConfirmDialogModal
          message={`Delete the record for keg ${deleteKegTarget.kegNumber}? This can't be undone.`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setDeleteKegTarget(null)}
          onConfirm={() => {
            deleteKeg(deleteKegTarget.id);
            setDeleteKegTarget(null);
            setSelectedKegId(null);
          }}
        />
      )}

      {showAdd && (
        <AddBatchModal
          onClose={() => {
            setShowAdd(false);
            setBrewRecipe(null);
            setBatchPreset(null);
          }}
          onAdd={addBatch}
          nextNumber={nextNumber}
          nextCiderNumber={nextCiderNumber}
          recipes={recipes}
          presetRecipe={brewRecipe}
          tanks={tanks}
          batches={batches}
          inventory={inventory}
          onAddInventoryItem={addInventoryItem}
          presetTankId={batchPreset ? batchPreset.tankId : null}
          presetStartDate={batchPreset ? batchPreset.startDate : null}
          presetName={batchPreset ? batchPreset.name : null}
          presetProductType={batchPreset ? batchPreset.productType : null}
          yeastHarvests={yeastHarvests}
          onUseHarvest={markYeastHarvestUsed}
        />
      )}
      {(showScheduleModal || editScheduledBatchId) && (() => {
        const editingBatch = editScheduledBatchId ? batches.find((b) => b.id === editScheduledBatchId) : null;
        if (editScheduledBatchId && !editingBatch) return null;
        return (
          <EditScheduledBatchModal
            batch={editingBatch}
            tanks={tanks}
            batches={batches}
            recipes={recipes}
            onSave={updateScheduledBatch}
            onCreate={addBatch}
            onDelete={isOwner ? deleteBatch : undefined}
            onClose={() => {
              setEditScheduledBatchId(null);
              setShowScheduleModal(false);
              setBatchPreset(null);
            }}
            nextNumber={nextNumber}
            presetTankId={batchPreset ? batchPreset.tankId : null}
            presetStartDate={batchPreset ? batchPreset.startDate : null}
          />
        );
      })()}
      {qrTankTarget && <TankQRModal tank={qrTankTarget} onClose={() => setQrTankTarget(null)} />}
      {historyTankTarget && (
        <TankHistoryModal
          tank={historyTankTarget}
          batches={batches}
          onClose={() => setHistoryTankTarget(null)}
          onOpenBatch={(id) => {
            setHistoryTankTarget(null);
            setSelectedId(id);
            setView("batches");
          }}
        />
      )}
      {showHelpGuide && <HelpGuideModal onClose={() => setShowHelpGuide(false)} />}
      {showAiHelper && (
        <AiHelperModal
          messages={aiChatMessages}
          setMessages={setAiChatMessages}
          onClose={() => setShowAiHelper(false)}
          onAsk={askAiHelper}
          onFlag={saveAiFeedback}
        />
      )}
      {showAiFeedbackReview && <AiFeedbackReviewModal feedback={aiFeedback} onClose={() => setShowAiFeedbackReview(false)} onDelete={deleteAiFeedback} />}
      {showWelcomeTour && <SpotlightTour steps={TOUR_STEPS} showLogoOnFirst onClose={dismissWelcomeTour} setSidebarOpen={setSidebarOpen} />}
      {pageTourKey && PAGE_TOURS[pageTourKey] && <SpotlightTour steps={PAGE_TOURS[pageTourKey]} onClose={dismissPageTour} setSidebarOpen={setSidebarOpen} />}
      {showWhatsNew && <WhatsNewModal onClose={dismissWhatsNew} entries={CHANGELOG} />}
      {showQuickJump && (
        <QuickJumpModal
          onClose={() => setShowQuickJump(false)}
          batches={batches}
          recipes={recipes}
          purchaseOrders={purchaseOrders}
          tanks={tanks}
          inventory={inventory}
          consumables={consumables}
          suppliers={suppliers}
          foodSafetyRecords={foodSafetyRecords}
          onOpenBatch={(id) => {
            setSelectedId(id);
            setView("batches");
            setShowQuickJump(false);
          }}
          onOpenRecipe={(id) => {
            setSelectedRecipeId(id);
            setView("recipes");
            setShowQuickJump(false);
          }}
          onOpenPO={(id) => {
            setSelectedPOId(id);
            setView("orders");
            setShowQuickJump(false);
          }}
          onOpenTank={() => {
            setView("brewery");
            setShowQuickJump(false);
          }}
          onOpenInventory={(id) => {
            setSelectedInventoryId(id);
            setView("inventory");
            setShowQuickJump(false);
          }}
          onOpenConsumable={(id) => {
            setSelectedConsumableId(id);
            setView("consumables");
            setShowQuickJump(false);
          }}
          onOpenSupplier={(s) => {
            setViewingSupplierDocs(s);
            setShowQuickJump(false);
          }}
          onOpenFoodSafety={() => {
            setView("foodsafety");
            setShowQuickJump(false);
          }}
        />
      )}
      {showAddInventory && (
        <AddInventoryModal
          onClose={() => setShowAddInventory(false)}
          onAdd={addInventoryItem}
          suppliers={suppliers}
          storageKey="brewpoint-last-ingredient-category"
        />
      )}
      {showBulkOpeningStock && (
        <BulkOpeningStockModal
          inventory={inventory}
          onClose={() => setShowBulkOpeningStock(false)}
          onSave={addBulkOpeningStock}
        />
      )}
      {showBulkOpeningStockConsumables && (
        <BulkOpeningStockModal
          inventory={consumables}
          onClose={() => setShowBulkOpeningStockConsumables(false)}
          onSave={addBulkOpeningStockConsumables}
          categories={CONSUMABLE_CATEGORIES}
          title="Bring in opening consumables stock"
        />
      )}
      {showAddConsumable && (
        <AddInventoryModal
          onClose={() => setShowAddConsumable(false)}
          onAdd={addConsumable}
          suppliers={suppliers}
          categories={CONSUMABLE_CATEGORIES}
          unitOptions={["ea", "box", "roll"]}
          title="New consumable"
          submitLabel="Add to consumables"
          showCost={isOwner}
          storageKey="brewpoint-last-consumable-category"
        />
      )}
      {showAddPackageType && (
        <AddPackageTypeModal onClose={() => setShowAddPackageType(false)} onAdd={addPackageType} consumables={consumables} />
      )}
      {showAddCustomer && (
        <CustomerFormModal onClose={() => setShowAddCustomer(false)} onSave={addCustomer} />
      )}
      {editingCustomer && (
        <CustomerFormModal
          customer={editingCustomer}
          onClose={() => setEditingCustomer(null)}
          onSave={(patch) => updateCustomer(editingCustomer.id, patch)}
        />
      )}
      {showAddSalesOrder && (
        <AddSalesOrderModal
          onClose={() => setShowAddSalesOrder(false)}
          onAdd={addSalesOrder}
          customers={customers}
          availableStock={availableStock}
          mixedPackStock={mixedPackStock}
          nextOrderNumber={nextSalesOrderNumber}
        />
      )}
      {xeroContactLinkTarget && (
        <XeroContactLinkModal
          customer={xeroContactLinkTarget}
          contacts={xeroContacts}
          onClose={() => setXeroContactLinkTarget(null)}
          onLink={linkCustomerToXero}
          onCreate={createXeroContactForCustomer}
        />
      )}
      {showImportXeroContacts && (
        <ImportXeroContactsModal
          contacts={xeroContacts}
          existingCustomers={customers}
          onClose={() => setShowImportXeroContacts(false)}
          onImport={importXeroContacts}
        />
      )}
      {showXeroProductMapping && (
        <XeroProductMappingModal
          recipes={activeRecipesByFamily(recipes)}
          xeroItems={xeroItems}
          existingMappings={xeroItemMappings}
          onClose={() => setShowXeroProductMapping(false)}
          onSave={saveXeroProductMappings}
        />
      )}
      {showStockTake && (
        <StockTakeModal inventory={inventory} onClose={() => setShowStockTake(false)} onComplete={completeStockTake} />
      )}
      {showStockTakeHistory && (
        <StockTakeHistoryModal
          stockTakes={stockTakes.filter((st) => st.type !== "consumables")}
          onClose={() => setShowStockTakeHistory(false)}
          onOpenReport={(st) => {
            setViewingStockTake(st);
            setShowStockTakeHistory(false);
          }}
        />
      )}
      {viewingStockTake && (
        <StockTakeReportModal stockTake={viewingStockTake} onClose={() => setViewingStockTake(null)} />
      )}
      {showConsumablesStockTake && (
        <StockTakeModal inventory={consumables} itemLabel="item" onClose={() => setShowConsumablesStockTake(false)} onComplete={completeConsumablesStockTake} />
      )}
      {showConsumablesStockTakeHistory && (
        <StockTakeHistoryModal
          stockTakes={stockTakes.filter((st) => st.type === "consumables")}
          onClose={() => setShowConsumablesStockTakeHistory(false)}
          onOpenReport={(st) => {
            setViewingConsumablesStockTake(st);
            setShowConsumablesStockTakeHistory(false);
          }}
        />
      )}
      {viewingConsumablesStockTake && (
        <StockTakeReportModal stockTake={viewingConsumablesStockTake} onClose={() => setViewingConsumablesStockTake(null)} />
      )}
      {showFinishedStockTake && (
        <StockTakeModal
          inventory={availableStock
            .filter((s) => s.packaged > 0)
            .map((s) =>
              s.containerKey === "cans330"
                ? { id: `${s.batchId}::${s.containerKey}`, name: `${s.batchName} — 330ml Cans`, qty: s.available, unit: "cans", casePack: CANS_PER_CASE, category: s.batchName }
                : { id: `${s.batchId}::${s.containerKey}`, name: `${s.batchName} — ${s.containerLabel}`, qty: s.available, unit: "units", category: s.batchName }
            )}
          itemLabel="item"
          onClose={() => setShowFinishedStockTake(false)}
          onComplete={completeFinishedStockTake}
        />
      )}
      {showFinishedStockTakeHistory && (
        <StockTakeHistoryModal
          stockTakes={stockTakes.filter((st) => st.type === "finished_stock")}
          onClose={() => setShowFinishedStockTakeHistory(false)}
          onOpenReport={(st) => {
            setViewingFinishedStockTake(st);
            setShowFinishedStockTakeHistory(false);
          }}
        />
      )}
      {viewingFinishedStockTake && (
        <StockTakeReportModal stockTake={viewingFinishedStockTake} onClose={() => setViewingFinishedStockTake(null)} />
      )}
      {activeChecklistTemplate && (
        <FoodSafetyChecklistModal
          template={activeChecklistTemplate}
          onClose={() => setActiveChecklistTemplate(null)}
          onSave={addFoodSafetyRecord}
        />
      )}
      {showCalibrationModal && (
        <CalibrationModal onClose={() => setShowCalibrationModal(false)} onSave={addFoodSafetyRecord} />
      )}
      {showMaintenanceModal && (
        <MaintenanceModal onClose={() => setShowMaintenanceModal(false)} onSave={addFoodSafetyRecord} />
      )}
      {showTrainingModal && (
        <TrainingModal onClose={() => setShowTrainingModal(false)} onSave={addFoodSafetyRecord} existingRecords={foodSafetyRecords} />
      )}
      {showIllnessModal && (
        <StaffIllnessModal onClose={() => setShowIllnessModal(false)} onSave={addFoodSafetyRecord} existingRecords={foodSafetyRecords} />
      )}
      {activeNoteModal && (
        <FoodSafetyNoteModal
          category={activeNoteModal.category}
          title={activeNoteModal.title}
          onClose={() => setActiveNoteModal(null)}
          onSave={addFoodSafetyRecord}
        />
      )}
      {viewingStaffTraining && (
        <StaffTrainingRecordModal
          staffName={viewingStaffTraining}
          records={foodSafetyRecords}
          onClose={() => setViewingStaffTraining(null)}
        />
      )}
      {xeroCompareItems && (
        <XeroStockCompareModal
          xeroItems={xeroCompareItems}
          salesMap={xeroSalesMap}
          itemMappings={xeroItemMappings}
          availableStock={availableStock}
          onClose={() => setXeroCompareItems(null)}
          onMatch={matchStockToXero}
          onMatchItems={() => {
            setXeroCompareItems(null);
            openXeroItemMatch();
          }}
        />
      )}
      {showSameBeer && <SameBeerModal batches={batches} aliases={beerAliases} onClose={() => setShowSameBeer(false)} onSave={saveBeerAliases} />}
      {xeroMatchItems && (
        <XeroItemMatchModal
          xeroItems={xeroMatchItems}
          beerNames={[...new Set(batches.filter((b) => b.packaging).map((b) => canonicalBeerName(b.name)))].sort((a, b) => a.localeCompare(b))}
          onOpenSameBeer={() => setShowSameBeer(true)}
          existing={xeroSalesMap}
          highlightCodes={xeroUnmatched}
          onClose={() => setXeroMatchItems(null)}
          onSave={async (records) => {
            const ok = await saveXeroSalesMap(records);
            if (ok) setTimeout(() => syncSalesRef.current(false), 300);
            return ok;
          }}
        />
      )}
      {xeroMappingQueue && (
        <XeroMappingModal
          queue={xeroMappingQueue}
          xeroItems={xeroItems}
          onConfirm={confirmXeroMappings}
          onClose={() => setXeroMappingQueue(null)}
        />
      )}
      {diacetylTestTarget && (
        <DiacetylTestModal
          batch={diacetylTestTarget}
          onClose={() => setDiacetylTestTarget(null)}
          onLog={logDiacetylTest}
        />
      )}
      {showSuppliersModal && (
        <SuppliersModal
          suppliers={suppliers}
          purchaseOrders={purchaseOrders}
          isOwner={isOwner}
          onClose={() => setShowSuppliersModal(false)}
          onAddNew={() => {
            setShowSuppliersModal(false);
            setEditingSupplier(null);
            setShowSupplierForm(true);
          }}
          onEdit={(s) => {
            setShowSuppliersModal(false);
            setEditingSupplier(s);
            setShowSupplierForm(true);
          }}
          onDelete={isOwner ? (s) => {
            setShowSuppliersModal(false);
            setDeleteSupplierTarget(s);
          } : undefined}
        />
      )}
      {showSupplierForm && (
        <SupplierFormModal
          supplier={editingSupplier}
          onClose={() => {
            setShowSupplierForm(false);
            setShowSuppliersModal(true);
          }}
          onSave={(data) => (editingSupplier ? updateSupplier(editingSupplier.id, data) : addSupplier(data))}
        />
      )}
      {scaleRecipeTarget && (
        <ScaleRecipeModal recipe={scaleRecipeTarget} onClose={() => setScaleRecipeTarget(null)} onScale={scaleRecipe} />
      )}
      {deleteSupplierTarget && (
        <ConfirmDeleteSupplierModal
          supplier={deleteSupplierTarget}
          onClose={() => {
            setDeleteSupplierTarget(null);
            setShowSuppliersModal(true);
          }}
          onConfirm={deleteSupplier}
        />
      )}
      {viewingSupplierDocs && (
        <SupplierDocumentsModal
          supplier={viewingSupplierDocs}
          documents={supplierDocuments.filter((d) => d.supplierId === viewingSupplierDocs.id)}
          onClose={() => setViewingSupplierDocs(null)}
          onUpload={uploadSupplierDocument}
          onDelete={isOwner ? deleteSupplierDocument : undefined}
          onOpen={openSupplierDocument}
        />
      )}
      {showAddPO && <AddPOModal onClose={() => setShowAddPO(false)} onAdd={addPO} onSave={updatePO} nextPONumber={nextPONumber} suppliers={suppliers} inventory={inventory} onExtractDocument={extractDocument} />}
      {reorderItem && (
        <AddPOModal
          onClose={() => setReorderItem(null)}
          onAdd={addPO}
          onSave={updatePO}
          nextPONumber={nextPONumber}
          suppliers={suppliers}
          inventory={inventory}
          onExtractDocument={extractDocument}
          presetItem={reorderItem}
        />
      )}
      {editingPO && (
        <AddPOModal
          onClose={() => setEditingPO(null)}
          onAdd={addPO}
          onSave={updatePO}
          nextPONumber={nextPONumber}
          suppliers={suppliers}
          inventory={inventory}
          onExtractDocument={extractDocument}
          editingPO={editingPO}
        />
      )}
      {showAddRecipe && (
        <AddRecipeModal
          onClose={() => setShowAddRecipe(false)}
          onAdd={addRecipe}
          inventory={inventory}
          onAddInventoryItem={addInventoryItem}
        />
      )}
      {editRecipeTarget && (
        <AddRecipeModal
          editingRecipe={editRecipeTarget}
          onClose={() => setEditRecipeTarget(null)}
          onAdd={addRecipe}
          inventory={inventory}
          onAddInventoryItem={addInventoryItem}
        />
      )}
      {showAddTank && <AddTankModal onClose={() => setShowAddTank(false)} onAdd={addTank} barrelAgingEnabled={barrelAgingModuleEnabled} />}
      {editTankTarget && (
        <EditTankModal tank={editTankTarget} onClose={() => setEditTankTarget(null)} onSave={updateTank} barrelAgingEnabled={barrelAgingModuleEnabled} />
      )}
      {deleteTankTarget && (
        <ConfirmDeleteTankModal tank={deleteTankTarget} onClose={() => setDeleteTankTarget(null)} onConfirm={deleteTank} />
      )}
      {deleteRecipeTarget && (
        <ConfirmDeleteRecipeModal recipe={deleteRecipeTarget} onClose={() => setDeleteRecipeTarget(null)} onConfirm={deleteRecipe} />
      )}
      {deleteBatchTarget && (
        <ConfirmDeleteBatchModal batch={deleteBatchTarget} onClose={() => setDeleteBatchTarget(null)} onConfirm={deleteBatch} />
      )}
      {adjustTarget && (
        <AdjustInventoryModal item={adjustTarget} onClose={() => setAdjustTarget(null)} onSave={adjustInventoryWithNote} />
      )}
      {consumableAdjustTarget && (
        <AdjustInventoryModal item={consumableAdjustTarget} onClose={() => setConsumableAdjustTarget(null)} onSave={adjustConsumableWithNote} />
      )}
      {assignTankTarget && (
        <AssignTankModal batch={assignTankTarget} tanks={tanks} batches={batches} onClose={() => setAssignTankTarget(null)} onSave={assignBatchTank} />
      )}
      {vesselTransferTarget && (
        <VesselTransferModal
          batch={vesselTransferTarget.batch}
          tanks={tanks}
          batches={batches}
          toType={vesselTransferTarget.toType}
          actionLabel={vesselTransferTarget.actionLabel}
          onClose={() => setVesselTransferTarget(null)}
          onSave={(tank, date) => transferBatchVessel(vesselTransferTarget.batch.id, tank, vesselTransferTarget.brewStage, vesselTransferTarget.newStage, date)}
        />
      )}
      {editSplitTanksTarget && (
        <EditSplitTanksModal
          batch={editSplitTanksTarget}
          tanks={tanks}
          batches={batches}
          onClose={() => setEditSplitTanksTarget(null)}
          onSave={splitBatchIntoTanks}
        />
      )}
      {convertSplitTarget && (
        <ConfirmDialogModal
          title="Convert to separate batches?"
          message={`Each tank in ${convertSplitTarget.name} becomes its own fully independent batch, carrying forward everything already logged for it. This can't be undone.`}
          confirmLabel="Convert"
          destructive
          onCancel={() => setConvertSplitTarget(null)}
          onConfirm={() => {
            convertSplitTanksToBatches(convertSplitTarget.id);
            setConvertSplitTarget(null);
          }}
        />
      )}
      {fermenterTransferTarget && (
        <TransferToFermenterModal
          batch={fermenterTransferTarget}
          tanks={tanks}
          batches={batches}
          onClose={() => setFermenterTransferTarget(null)}
          onSave={(tanksChosen, date) => transferToFermenter(fermenterTransferTarget.id, tanksChosen, date)}
        />
      )}
      {startPackagingTarget && (
        <StartPackagingModal
          batch={startPackagingTarget}
          onClose={() => setStartPackagingTarget(null)}
          onSave={(containerType) => {
            startPackagingRun(startPackagingTarget.id, containerType);
            setStartPackagingTarget(null);
          }}
        />
      )}
      {confirmTarget && (
        <ConfirmDialogModal
          message={confirmTarget.message}
          title={confirmTarget.title}
          confirmLabel={confirmTarget.confirmLabel}
          destructive={confirmTarget.destructive}
          onCancel={() => setConfirmTarget(null)}
          onConfirm={() => {
            confirmTarget.onConfirm();
            setConfirmTarget(null);
          }}
        />
      )}
      {logTarget && (
        <LogReadingModal batch={logTarget.batch} tankId={logTarget.tankId} tankName={logTarget.tankName} onClose={() => setLogTarget(null)} onLog={logReading} />
      )}
      {brewDayFieldTarget && (
        <EditBrewDayFieldModal target={brewDayFieldTarget} onClose={() => setBrewDayFieldTarget(null)} onSave={updateBrewDayField} />
      )}
      {packagingTarget && (() => {
        const liveBatch = batches.find((b) => b.id === packagingTarget.id) || packagingTarget;
        return (
          <PackagingModal
            batch={liveBatch}
            onClose={() => setPackagingTarget(null)}
            onSave={logPackagingSession}
            packageTypes={packageTypes}
            onToggleFault={toggleBatchFault}
            sisters={sisterTankBatches(liveBatch, batches)}
          />
        );
      })()}
      {discardTarget && (
        <DiscardRemainingModal batch={discardTarget} onClose={() => setDiscardTarget(null)} onConfirm={discardRemaining} />
      )}
      {showDeleteAccount && (
        <DeleteAccountModal onClose={() => setShowDeleteAccount(false)} onConfirm={deleteAccount} />
      )}
      {showDeleteCompany && (
        <DeleteCompanyModal onClose={() => setShowDeleteCompany(false)} onConfirm={deleteCompany} />
      )}
    </div>
  );
}

export default function TankLog() {
  // The URLs in this app that aren't the authenticated staff shell — a
  // customer's order link, or the token-based one for links already sent
  // out before real logins existed. Checked before anything else even
  // tries to load a staff session, since there isn't one for these pages
  // and there never should be.
  const path = window.location.pathname;
  const portalMatch = path.match(/^\/order\/([a-zA-Z0-9-]+)/);
  if (portalMatch) {
    return (
      <BrewpointErrorBoundary>
        <CustomerPortalPage credential={{ token: portalMatch[1] }} />
      </BrewpointErrorBoundary>
    );
  }
  if (path === "/order" || path === "/order/") {
    return (
      <BrewpointErrorBoundary>
        <CustomerAccountFlow />
      </BrewpointErrorBoundary>
    );
  }

  return (
    <BrewpointErrorBoundary>
      <TankLogApp />
    </BrewpointErrorBoundary>
  );
}
