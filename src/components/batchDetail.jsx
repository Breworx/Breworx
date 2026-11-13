import { batchFullCost } from "../lib/batchCost";
import React, { useState } from "react";
import { Plus, Droplet, ChevronLeft, X, TrendingDown, Package, CheckCircle2, Trash2, FileText, FlaskConical, RotateCcw, Thermometer, Gauge } from "lucide-react";
import { BrewDayTimers, DumpLogCheckbox, SplitTankFaultsSection, SplitTankNotesSection, SplitTankReadingsSection, barToPsi, psiToBar } from "./batches";
import { Tank } from "./cards";
import { CiderBatchPanel } from "./cider";
import { canCasesText } from "./finishedStock";
import { SENSORY_CATEGORIES, TASTING_TAGS } from "./foodSafety";
import { TrendChart } from "./quality";
import { BackdateField, StageDateModal } from "./ui";
import { attenuation, calcABV, formatHistoryStamp } from "../lib/brewing";
import { CATEGORY_COLOR, latestReading } from "../lib/config";
import { BREW_STAGE_INFO, COMMON_FAULTS, CONTAINERS, FAULT_SEVERITY_COLOR, STAGE_COLOR, aggregatePackagingCounts, batchTankIds, batchTankSummary, compareScheduleItems, currentFaults, formatQty, packagedVolume, packagingDiscarded, packagingEvents, remainingVolume, totalPackagedVolume } from "../lib/production";
import { daysBetween, today } from "../lib/utils";

export function BatchDetail({ batch, onBack, onAdvance, onMoveBack, onLogReading, onDeleteReading, onEditBrewDayField, onOpenPackaging, onStartPackaging, onCancelPackagingRun, onUndoPackagingEvent, onDiscardRemaining, onAssignTank, onToggleScheduleStep, onDeleteBatch, stages, onLogDiacetylTest, onToggleFault, onUploadPhoto, onDeletePhoto, onStartTimer, onStopTimer, tanks, onStartRecirculation, onOpenVesselTransfer, onEditSplitTanks, onOpenFermenterTransfer, onSetCarbonationChecked, onSetBrewDayCheckbox, onAddNote, onDeleteNote, onOpenTastingLog, onOpenSensoryScore, onOpenQcApproval, onOpenLabMeasurement, onSetStillFermenting, onUpdateTankSettings, onLogDump, onUndoDump, onOpenTopUp, yeastHarvests, onOpenHarvestYeast, onAddSplitTankIngredient, onAddBatchIngredient, onAddBrewDay, recipes, allBatches, onOpenBatch, onConvertSplitTanks, isOwner, onOpenCiderTools, consumables, costing, exciseAbvMethod }) {
  // Cider gets its own version of this page: no mash, boil, hop or
  // diacetyl sections; juice, additions, back-sweetening and blends instead.
  const isCider = batch.productType === "Cider/Perry";
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteDate, setNoteDate] = useState(today());
  const [stageDateOpen, setStageDateOpen] = useState(false);
  const [showTankSettingsForm, setShowTankSettingsForm] = useState(false);
  const latestTankSettings = batch.tankSettingsLog && batch.tankSettingsLog.length > 0 ? [...batch.tankSettingsLog].sort((a, b) => b.date.localeCompare(a.date))[0] : null;
  const [setTempInput, setSetTempInput] = useState(latestTankSettings?.setTemp != null ? String(latestTankSettings.setTemp) : "");
  const [setPressureInput, setSetPressureInput] = useState(latestTankSettings?.setPressure != null ? String(latestTankSettings.setPressure) : "");
  const [pressureUnit, setPressureUnit] = useState(latestTankSettings?.pressureUnit || "PSI");
  const latest = latestReading(batch);
  const pct = attenuation(batch.og, batch.fg, latest.gravity);
  const days = daysBetween(batch.startDate, today());
  const stageIdx = stages.indexOf(batch.stage);
  const currentTank = tanks ? tanks.find((t) => t.id === batch.tankId) : null;
  const inMashTun = batch.stage === "Brewing" && currentTank?.type === "Mash Tun";
  const inKettle = batch.stage === "Brewing" && currentTank?.type === "Kettle";
  const chartData = batch.readings.map((r) => ({
    date: r.date.slice(5),
    gravity: r.gravity,
    temp: r.temp,
  }));

  return (
    <div>
      <button
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          color: "#5C6B54",
          cursor: "pointer",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          padding: 0,
          marginBottom: 18,
        }}
      >
        <ChevronLeft size={16} /> All batches
      </button>

      {batch.mergedIntoBatchId && (
        <div style={{ background: "#EAF2E4", border: "1px solid #8FB86C", borderRadius: 6, padding: "10px 14px", marginBottom: 18, color: "#3F6B32", fontSize: 13 }}>
          This batch was merged into another batch as a brew day and is no longer active on its own — its readings and history below are kept for reference.
        </div>
      )}

      <div style={{ display: "flex", gap: 18, alignItems: "center", marginBottom: 22 }}>
        <Tank
          batch={batch}
          vesselType={currentTank?.type}
          tankCapacity={tanks ? batchTankIds(batch).reduce((sum, id) => sum + (tanks.find((t) => t.id === id)?.capacity || 0), 0) : 0}
        />
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 13 }}>
            Batch #{batch.number}
          </div>
          <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 28, color: "#2A3324", margin: "2px 0 6px", fontWeight: 500 }}>
            {batch.name}
          </h1>
          <div style={{ color: "#5C6B54", fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
            <span>
              {batch.style} · {batch.volume}L{batchTankSummary(batch) ? ` · ${batchTankSummary(batch)}` : " · No tank assigned"}
            </span>
            <button
              onClick={() => (batch.splitTanks && batch.splitTanks.length > 0 ? onEditSplitTanks(batch) : onAssignTank(batch))}
              style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12.5, fontFamily: "'Inter', sans-serif", padding: 0 }}
            >
              Change
            </button>
          </div>
          {(inMashTun || inKettle) && batch.brewStage && BREW_STAGE_INFO[batch.brewStage] && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                marginTop: 8,
                background: `${BREW_STAGE_INFO[batch.brewStage].color}22`,
                border: `1px solid ${BREW_STAGE_INFO[batch.brewStage].color}`,
                borderRadius: 20,
                padding: "5px 12px",
                fontFamily: "'Inter', sans-serif",
                fontSize: 12.5,
                color: BREW_STAGE_INFO[batch.brewStage].color,
              }}
            >
              {inKettle ? <FlaskConical size={13} /> : <RotateCcw size={13} />}
              {BREW_STAGE_INFO[batch.brewStage].label} — {currentTank?.name}
            </div>
          )}
        </div>
      </div>

      {batch.stage === "Aging" ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 22,
            padding: "12px 14px",
            background: "#F5F1FA",
            border: "1px solid #8E6FB5",
            borderRadius: 6,
          }}
        >
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#8E6FB5", flexShrink: 0 }} />
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: "0.04em", textTransform: "uppercase", color: "#6F5290" }}>
            {currentTank?.type === "Barrel" && batch.stillFermenting ? "Fermenting in barrel" : "Aging"}
            {currentTank ? ` · ${currentTank.name}` : ""}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", marginBottom: 22, padding: "0 4px" }}>
          {stages.map((s, i) => {
            const done = i < stageIdx;
            const current = i === stageIdx;
            const color = done || current ? STAGE_COLOR[s] || "#5C9A3C" : "#DDE0C8";
            return (
              <React.Fragment key={s}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <div
                    style={{
                      width: current ? 16 : 12,
                      height: current ? 16 : 12,
                      borderRadius: "50%",
                      background: done || current ? color : "#FFFFFF",
                      border: `2px solid ${color}`,
                      boxShadow: current ? `0 0 0 4px ${color}33` : "none",
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: "'JetBrains Mono', monospace",
                      letterSpacing: "0.03em",
                      textTransform: "uppercase",
                      color: done || current ? color : "#C9D1AC",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s}
                  </span>
                </div>
                {i < stages.length - 1 && (
                  <div style={{ flex: 1, height: 2, background: i < stageIdx ? STAGE_COLOR[stages[i]] || "#5C9A3C" : "#DDE0C8", margin: "0 4px 16px" }} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
        {(isCider
          ? [
              ["OG", batch.og != null ? batch.og.toFixed(3) : "—"],
              ["SG now", latest.gravity != null ? latest.gravity.toFixed(3) : "—"],
              ["ABV now", batch.og != null && latest.gravity != null ? `${calcABV(batch.og, latest.gravity).toFixed(1)}%` : "—"],
              ["Target FG", batch.fg != null ? batch.fg.toFixed(3) : "—"],
            ]
          : [
              ["OG", batch.og != null ? batch.og.toFixed(3) : "—"],
              ["Current SG", latest.gravity != null ? latest.gravity.toFixed(3) : "—"],
              ["Target FG", batch.fg != null ? batch.fg.toFixed(3) : "—"],
              ["Attenuation", batch.og != null && latest.gravity != null ? `${pct.toFixed(0)}%` : "—"],
            ]
        ).map(([label, val]) => (
          <div key={label} style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 12px" }}>
            <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>{label}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 17, color: "#2A3324", marginTop: 3 }}>{val}</div>
          </div>
        ))}
      </div>

      {isCider && <CiderBatchPanel batch={batch} onOpenCiderTools={onOpenCiderTools} />}

      {!isCider && batch.stage === "Brewing" && (
        <BrewDayTimers
          timers={batch.timers || []}
          onStart={(label, minutes) => onStartTimer(batch.id, label, minutes)}
          onStop={(id) => onStopTimer(batch.id, id)}
        />
      )}

      {batch.schedule && batch.schedule.length > 0 && (() => {
        const next = batch.schedule.find((s) => !s.done);
        return (
          <>
            {next && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "#FCF1DC",
                  border: "1px solid #E3D3A0",
                  borderRadius: 6,
                  padding: "10px 12px",
                  marginBottom: 12,
                }}
              >
                <Droplet size={15} color="#5C9A3C" />
                <div>
                  <div style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C9A3C" }}>Up next</div>
                  <div style={{ color: "#2A3324", fontSize: 13.5, marginTop: 1 }}>
                    {next.label} <span style={{ color: "#5C6B54", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>({next.amount} {next.unit})</span>
                  </div>
                </div>
              </div>
            )}
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
              Brew day schedule
            </div>
            {(() => {
              const sorted = [...batch.schedule].sort(compareScheduleItems);
              const pending = sorted.filter((s) => !s.done);
              const completed = sorted.filter((s) => s.done);
              const stepButton = (s) => (
                <button
                  key={s.id}
                  onClick={() => onToggleScheduleStep(batch.id, s.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    background: "#F8F5EA",
                    border: "1px solid #EBE8D6",
                    borderRadius: 5,
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                    opacity: s.done ? 0.6 : 1,
                  }}
                >
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      border: `1.5px solid ${s.done ? "#D9A441" : "#C9D1AC"}`,
                      background: s.done ? "#D9A441" : "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {s.done && <CheckCircle2 size={13} color="#16191A" />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: "#2A3324", textDecoration: s.done ? "line-through" : "none" }}>
                      {s.label} <span style={{ color: "#5C6B54", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }}>({s.amount} {s.unit})</span>
                    </div>
                    {s.done && s.doneAt && (
                      <div style={{ color: "#9BA88A", fontSize: 11, marginTop: 2 }}>Done {formatHistoryStamp(s.doneAt)}</div>
                    )}
                  </div>
                </button>
              );
              return (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: completed.length > 0 ? 10 : 22 }}>
                    {pending.map(stepButton)}
                    {pending.length === 0 && (
                      <div style={{ color: "#9BA88A", fontSize: 12.5, padding: "8px 4px" }}>All steps done.</div>
                    )}
                  </div>
                  {completed.length > 0 && (
                    <details style={{ marginBottom: 22 }}>
                      <summary style={{ cursor: "pointer", color: "#5C9A3C", fontSize: 12, fontFamily: "'Inter', sans-serif" }}>
                        {completed.length} completed step{completed.length !== 1 ? "s" : ""}
                      </summary>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                        {completed.map(stepButton)}
                      </div>
                    </details>
                  )}
                </>
              );
            })()}
          </>
        );
      })()}

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
        {isCider ? "Juice into tank" : "Brew day"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isCider ? "repeat(2, 1fr)" : "repeat(3, 1fr)", gap: 10, marginBottom: 22 }}>
        {(isCider
          ? [
              ["Juice pH", batch.phIntoTank, "phIntoTank", 0.01, "", 2],
              ["Juice SG", batch.sgIntoTank, "sgIntoTank", 0.001, "", 3],
            ]
          : [
              ["Mash pH", batch.mashPh, "mashPh", 0.01, "", 2],
              ["Mash temp", batch.mashTemp, "mashTemp", 0.5, "°C", 1],
              ["Pre-boil SG", batch.preBoilGravity, "preBoilGravity", 0.001, "", 3],
              ["Top-up water", batch.topUpWater, "topUpWater", 0.1, "L", 1],
              ["pH into tank", batch.phIntoTank, "phIntoTank", 0.01, "", 2],
              ["SG into tank", batch.sgIntoTank, "sgIntoTank", 0.001, "", 3],
            ]
        ).map(([label, rawVal, field, step, suffix, decimals]) => (
          <button
            key={field}
            onClick={() => onEditBrewDayField({ batch, field, label, value: rawVal, step, suffix })}
            style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 12px", cursor: "pointer", textAlign: "left" }}
          >
            <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>{label}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 17, color: "#2A3324", marginTop: 3 }}>
              {rawVal != null ? `${rawVal.toFixed(decimals)}${suffix ? ` ${suffix}` : ""}` : "—"}
            </div>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 24, marginBottom: 22, flexWrap: "wrap" }}>
        {!isCider && (
          <DumpLogCheckbox
            label="Hop dump done"
            log={batch.hopDumpLog}
            onLog={(d) => onLogDump(batch.id, "hopDumpLog", d)}
            onUndo={() => onUndoDump(batch.id, "hopDumpLog")}
          />
        )}
        <DumpLogCheckbox
          label={isCider ? "Racked off the lees" : "Yeast dump done"}
          log={batch.yeastDumpLog}
          onLog={(d) => onLogDump(batch.id, "yeastDumpLog", d)}
          onUndo={() => onUndoDump(batch.id, "yeastDumpLog")}
        />
        {isCider && batch.stage !== "Packaged" && !(batch.splitTanks && batch.splitTanks.length > 0) && (
          <button
            onClick={() => onAssignTank(batch, "rack")}
            style={{ background: "none", border: "1px solid #CFD6BC", borderRadius: 5, padding: "6px 12px", color: "#5C9A3C", cursor: "pointer", fontSize: 13, fontFamily: "'Inter', sans-serif" }}
          >
            Rack to another tank
          </button>
        )}
      </div>

      {batch.ingredients && batch.ingredients.length > 0 && (
        <details style={{ marginBottom: 22 }}>
          <summary style={{ cursor: "pointer", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>
            Ingredients{batch.recipeName ? ` — ${batch.recipeName}` : ""} ({batch.ingredients.length})
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            {batch.ingredients.map((ing) => (
              <div
                key={ing.id}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  padding: "9px 12px",
                  background: "#F8F5EA",
                  border: "1px solid #EBE8D6",
                  borderRadius: 5,
                  fontSize: 13,
                }}
              >
                <span style={{ flex: 1, color: "#2A3324", fontFamily: "'Inter', sans-serif" }}>{ing.name}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: CATEGORY_COLOR[ing.category], fontSize: 11 }}>
                  {ing.category}
                </span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54", width: 64, textAlign: "right", flexShrink: 0 }}>
                  {formatQty(ing.qty, ing.unit)}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      <div style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>
            Photos ({(batch.photos || []).length})
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "1px solid #DDE0C8",
              borderRadius: 5,
              padding: "6px 10px",
              color: "#5C6B54",
              fontFamily: "'Inter', sans-serif",
              fontSize: 12,
              cursor: uploadingPhoto ? "default" : "pointer",
            }}
          >
            <Plus size={12} /> {uploadingPhoto ? "Uploading…" : "Add photo"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={uploadingPhoto}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setUploadingPhoto(true);
                await onUploadPhoto(batch.id, file);
                setUploadingPhoto(false);
              }}
              style={{ display: "none" }}
            />
          </label>
        </div>
        {(batch.photos || []).length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 8 }}>
            {batch.photos.map((url, i) => (
              <div key={i} style={{ position: "relative" }}>
                <button
                  onClick={() => window.open(url, "_blank")}
                  style={{ display: "block", width: "100%", aspectRatio: "1", padding: 0, border: "1px solid #DDE0C8", borderRadius: 6, overflow: "hidden", cursor: "pointer", background: "#F8F5EA" }}
                >
                  <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </button>
                <button
                  onClick={() => onDeletePhoto(batch.id, url)}
                  aria-label="Delete photo"
                  style={{ position: "absolute", top: 4, right: 4, background: "rgba(10,12,11,0.6)", border: "none", borderRadius: 4, padding: 4, cursor: "pointer" }}
                >
                  <X size={11} color="#FFFFFF" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "center" }}>
        {stages.map((s, i) => (
          <React.Fragment key={s}>
            <span
              style={{
                fontSize: 11.5,
                fontFamily: "'JetBrains Mono', monospace",
                color: i <= stageIdx ? STAGE_COLOR[batch.stage] : "#C9D1AC",
                letterSpacing: "0.05em",
              }}
            >
              {s.toUpperCase()}
            </span>
            {i < stages.length - 1 && <span style={{ flex: 1, height: 1, background: i < stageIdx ? STAGE_COLOR[batch.stage] : "#DDE0C8" }} />}
          </React.Fragment>
        ))}
      </div>
      <div style={{ color: "#9BA88A", fontSize: 12.5, marginBottom: 18 }}>{days} days since brew day</div>

      {batch.packaging && (() => {
        const events = packagingEvents(batch);
        const discarded = packagingDiscarded(batch);
        const totals = aggregatePackagingCounts(batch);
        const remaining = remainingVolume(batch);
        return (
          <>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
              Packaging
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 10 }}>
              {CONTAINERS.map((c) => (
                <div key={c.key} style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 10px" }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>{c.shortLabel}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: "#2A3324", marginTop: 3 }}>
                    {totals[c.key] || 0}
                  </div>
                </div>
              ))}
            </div>

            {isOwner && (() => {
              const fc = batchFullCost(batch, { consumables, costing, abvMethod: exciseAbvMethod, recipes });
              if (!fc) return null;
              const m = (n) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toFixed(2)}`);
              const col = (p) => (p == null ? "#9BA88A" : p < 15 ? "#B5502F" : p < 30 ? "#8A6D0B" : "#3F7A2A");
              return (
                <div style={{ background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 6, padding: "10px 12px", marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                    <div style={{ fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>What this batch cost</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: "#2A3324" }}>{m(fc.total)}</div>
                  </div>
                  {fc.containers.map((c) => (
                    <div key={c.key} style={{ borderTop: "1px solid #EBE8D6", padding: "7px 0" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
                        <span style={{ color: "#2A3324" }}>{c.key === "cans330" ? `24-can case (${c.count} cans)` : `${c.shortLabel} × ${c.count}`}</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                          {m(c.each)} each
                          {c.price != null && <span style={{ color: col(c.marginPct) }}> · {c.marginPct.toFixed(0)}%</span>}
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: "#9BA88A", marginTop: 2, lineHeight: 1.45 }}>
                        Beer + excise {m(c.liquid)} + {c.key === "cans330" ? "cans, lids, labels & carton" : "keg hire"} {m(c.packaging)} + delivery {m(c.delivery)}
                        {c.key === "cans330" && <> · {m(c.perCan)} a can</>}
                        {c.price != null && <> · sells at {m(c.price)}, margin {m(c.margin)}</>}
                      </div>
                    </div>
                  ))}
                  <div style={{ fontSize: 11.5, color: "#9BA88A", marginTop: 4, lineHeight: 1.5 }}>
                    {fc.totalL.toFixed(0)}L packaged · ingredients {m(fc.ingredients)} · excise {m(fc.excise)} · levy {m(fc.levy)}. Ex GST.
                    {fc.product ? ` Prices and keg costs from the "${fc.product.name}" costing.` : " No matching costing, so no margins — keg hire and delivery from Costing defaults."}
                  </div>
                  {(fc.noIngredients || fc.missing.length > 0) && (
                    <div style={{ fontSize: 11.5, color: "#8A6D0B", marginTop: 4 }}>
                      Not counted: {[fc.noIngredients && "ingredients (no cost recorded)", ...fc.missing].filter(Boolean).join(", ")}.
                    </div>
                  )}
                </div>
              );
            })()}

            {events.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                {events.map((e) => (
                  <div
                    key={e.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 12px",
                      background: "#F8F5EA",
                      border: "1px solid #EBE8D6",
                      borderRadius: 5,
                      fontSize: 12.5,
                    }}
                  >
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", flexShrink: 0 }}>{(e.date || "").slice(5)}</span>
                    <span style={{ color: "#5C6B54", flex: 1 }}>
                      {CONTAINERS.filter((c) => (e[c.key] || 0) > 0).map((c) => `${e[c.key]}× ${c.shortLabel}`).join(" · ") || "—"}
                    </span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#2A3324", flexShrink: 0 }}>{packagedVolume(e).toFixed(2)} L</span>
                    <button
                      onClick={() => onUndoPackagingEvent(batch.id, e.id)}
                      aria-label="Undo this packaging run"
                      title="Undo — returns to Cooling and restores consumables"
                      style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 6, flexShrink: 0 }}
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ color: "#9BA88A", fontSize: 12.5, marginBottom: 10 }}>
              {totalPackagedVolume(batch).toFixed(2)} L packaged
              {discarded > 0 ? ` · ${discarded.toFixed(2)} L discarded` : ""}
              {" "}of {batch.volume} L batch
              {remaining > 0 ? ` · ${remaining.toFixed(2)} L still in tank` : " · fully accounted for"}
            </div>

            {remaining > 0 && (
              <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
                <button
                  onClick={() => (batch.packagingRun ? onOpenPackaging(batch) : onStartPackaging(batch))}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    background: "#EBE8D6",
                    border: "1px solid #C9D1AC",
                    borderRadius: 5,
                    padding: "10px",
                    color: "#2A3324",
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <Package size={14} /> {batch.packagingRun ? "Finish packaging" : "Log more packaging"}
                </button>
                <button
                  onClick={() => onDiscardRemaining(batch)}
                  style={{
                    flex: 1,
                    background: "none",
                    border: "1px solid #E3D3A0",
                    borderRadius: 5,
                    padding: "10px",
                    color: "#5C9A3C",
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Empty tank
                </button>
              </div>
            )}
          </>
        );
      })()}

      {[...(batch.xeroSold || []), ...(batch.salesHistory || [])].some((e) => Number(e.qty) !== 0) && (() => {
        // Where this batch went, from invoices in Xero (incl. Upstock orders).
        const sold = [...(batch.xeroSold || []), ...(batch.salesHistory || [])].filter((e) => Number(e.qty) !== 0).sort((a, b) => String(b.date).localeCompare(String(a.date)));
        const qtyText = (e) => {
          const n = Math.abs(Number(e.qty));
          const what = e.containerKey === "cans330" ? canCasesText(n) : `${n} × ${CONTAINERS.find((c) => c.key === e.containerKey)?.shortLabel || e.containerKey}`;
          return Number(e.qty) < 0 ? `${what} returned` : what;
        };
        return (
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>Where it went</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {sold.map((e, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "7px 10px", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4 }}>
                  <span style={{ color: "#2A3324" }}>{e.customer || "Customer not recorded"} — {qtyText(e)}</span>
                  <span style={{ color: "#9BA88A", whiteSpace: "nowrap" }}>{String(e.docNumber || "").startsWith("Xero sales") ? "Xero summary" : `Xero ${e.docNumber || "invoice"}`} · {e.date}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {inMashTun && (
        <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
          {batch.brewStage !== "Recirculating" ? (
            <button
              onClick={() => onStartRecirculation(batch.id, "Recirculating")}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                background: "#EBE8D6",
                border: "1px solid #C9D1AC",
                borderRadius: 5,
                padding: "11px",
                color: "#2A3324",
                fontFamily: "'Inter', sans-serif",
                fontSize: 13.5,
                cursor: "pointer",
              }}
            >
              <RotateCcw size={15} /> Start recirculation
            </button>
          ) : (
            <button
              onClick={() => onStartRecirculation(batch.id, "Mashing")}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                background: "#EBE8D6",
                border: "1px solid #C9D1AC",
                borderRadius: 5,
                padding: "11px",
                color: "#2A3324",
                fontFamily: "'Inter', sans-serif",
                fontSize: 13.5,
                cursor: "pointer",
              }}
            >
              <ChevronLeft size={15} /> Back to mashing
            </button>
          )}
          <button
            onClick={() => onOpenVesselTransfer({ batch, toType: "Kettle", brewStage: "Kettle", newStage: null, actionLabel: "Transfer to kettle" })}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              background: "#5C9A3C",
              border: "none",
              borderRadius: 5,
              padding: "11px",
              color: "#16191A",
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 13.5,
              letterSpacing: "0.02em",
              cursor: "pointer",
            }}
          >
            Transfer to kettle
          </button>
        </div>
      )}

      {inKettle && (
        <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
          <button
            onClick={() => onOpenVesselTransfer({ batch, toType: "Mash Tun", brewStage: "Mashing", newStage: null, actionLabel: "Move back to mash tun" })}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              background: "#EBE8D6",
              border: "1px solid #C9D1AC",
              borderRadius: 5,
              padding: "11px",
              color: "#2A3324",
              fontFamily: "'Inter', sans-serif",
              fontSize: 13.5,
              cursor: "pointer",
            }}
          >
            <ChevronLeft size={15} /> Back to mash tun
          </button>
          <button
            onClick={() => onOpenFermenterTransfer(batch)}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              background: "#5C9A3C",
              border: "none",
              borderRadius: 5,
              padding: "11px",
              color: "#16191A",
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 13.5,
              letterSpacing: "0.02em",
              cursor: "pointer",
            }}
          >
            Transfer to fermenter
          </button>
        </div>
      )}

      {!isCider && batch.stage === "Primary" && currentTank?.type !== "Kettle" && (() => {
        const kettles = tanks.filter((t) => t.type === "Kettle");
        if (kettles.length === 0) return null;
        return (
          <button
            onClick={() => onOpenVesselTransfer({ batch, toType: "Kettle", brewStage: "Kettle", newStage: "Brewing", actionLabel: "Move back to kettle" })}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              width: "100%",
              background: "#EBE8D6",
              border: "1px solid #C9D1AC",
              borderRadius: 5,
              padding: "11px",
              color: "#2A3324",
              fontFamily: "'Inter', sans-serif",
              fontSize: 13.5,
              cursor: "pointer",
              marginBottom: 8,
            }}
          >
            <ChevronLeft size={15} /> Transferred too early? Move back to kettle
          </button>
        );
      })()}

      <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
        {(!batch.splitTanks || batch.splitTanks.length === 0) && (
          <button
            onClick={() => onLogReading(batch)}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              background: "#EBE8D6",
              border: "1px solid #C9D1AC",
              borderRadius: 5,
              padding: "11px",
              color: "#2A3324",
              fontFamily: "'Inter', sans-serif",
              fontSize: 13.5,
              cursor: "pointer",
            }}
          >
            <Droplet size={15} /> Log reading
          </button>
        )}
        {!inMashTun && !inKettle && stageIdx < stages.length - 1 && (() => {
          const nextStage = stages[stageIdx + 1];
          const needsDiacetylPass = batch.stage === "Primary" && nextStage === "Cooling";
          const hasDiacetylPass = (batch.diacetylTests || []).some((t) => t.result === "pass");
          const isPackagingStep = nextStage === "Packaged";
          const isBriteStep = nextStage === "Brite Tank";
          const packagingStarted = isPackagingStep && batch.packagingRun;
          const needsCarbonationCheck = isPackagingStep && !packagingStarted;
          const blocked = (needsDiacetylPass && !hasDiacetylPass) || (needsCarbonationCheck && !batch.carbonationChecked);
          return (
            <button
              onClick={() => {
                if (blocked) return;
                if (isBriteStep) {
                  onOpenVesselTransfer({ batch, toType: "Brite Tank", brewStage: null, newStage: "Brite Tank", actionLabel: "Transfer to Brite tank" });
                  return;
                }
                if (!isPackagingStep) { onAdvance(batch.id); return; }
                packagingStarted ? onOpenPackaging(batch) : onStartPackaging(batch);
              }}
              disabled={blocked}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                background: blocked ? "#E8E4D4" : "#5C9A3C",
                border: "none",
                borderRadius: 5,
                padding: "11px",
                color: blocked ? "#A3AC94" : "#16191A",
                fontFamily: "'Oswald', sans-serif",
                fontWeight: 500,
                fontSize: 13.5,
                letterSpacing: "0.02em",
                cursor: blocked ? "default" : "pointer",
              }}
            >
              {isPackagingStep && <Package size={15} />}
              {needsDiacetylPass && !hasDiacetylPass
                ? "Log a passing diacetyl test first"
                : needsCarbonationCheck && !batch.carbonationChecked
                ? "Confirm carbonation is checked first"
                : isBriteStep
                ? "Transfer to Brite tank"
                : !isPackagingStep
                ? `Advance to ${nextStage}`
                : packagingStarted
                ? "Finish packaging"
                : "Start packaging"}
            </button>
          );
        })()}
      </div>
      {!inMashTun && !inKettle && stageIdx < stages.length - 1 && stages[stageIdx + 1] !== "Packaged" && stages[stageIdx + 1] !== "Brite Tank" &&
        !(batch.stage === "Primary" && stages[stageIdx + 1] === "Cooling" && !(batch.diacetylTests || []).some((t) => t.result === "pass")) && (
          <button
            onClick={() => setStageDateOpen(true)}
            style={{ background: "none", border: "none", color: "#5C6B54", fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: "0 0 8px" }}
          >
            Already happened earlier? Set the date
          </button>
        )}
      {batch.stageDates && Object.keys(batch.stageDates).length > 0 && (
        <div style={{ color: "#9BA88A", fontSize: 11.5, marginBottom: 8 }}>
          {stages.filter((st) => batch.stageDates[st]).map((st) => `${st} ${batch.stageDates[st]}`).join(" · ")}
        </div>
      )}
      {stageDateOpen && (
        <StageDateModal
          title={`Advance to ${stages[stageIdx + 1]}`}
          confirmLabel={`Advance to ${stages[stageIdx + 1]}`}
          onClose={() => setStageDateOpen(false)}
          onConfirm={(d) => onAdvance(batch.id, d)}
        />
      )}
      {!inMashTun && (batch.stage === "Primary" || batch.stage === "Brite Tank" || inKettle) && (
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button
            onClick={() =>
              onOpenVesselTransfer({ batch, toType: "Barrel", brewStage: null, newStage: "Aging", actionLabel: "Move to a barrel" })
            }
            style={{ flex: 1, background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "9px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
          >
            Move to a barrel
          </button>
          <button
            onClick={() =>
              onOpenVesselTransfer({ batch, toType: "Aging Tank", brewStage: null, newStage: "Aging", actionLabel: "Move to an aging tank" })
            }
            style={{ flex: 1, background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "9px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
          >
            Move to an aging tank
          </button>
        </div>
      )}
      {!inMashTun && !inKettle && stageIdx < stages.length - 1 && stages[stageIdx + 1] === "Packaged" && !batch.packagingRun && (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
            cursor: "pointer",
            color: batch.carbonationChecked ? "#5C6B54" : "#B5502F",
            fontSize: 12.5,
            fontFamily: "'Inter', sans-serif",
          }}
        >
          <input
            type="checkbox"
            checked={!!batch.carbonationChecked}
            onChange={(e) => onSetCarbonationChecked(batch.id, e.target.checked)}
            style={{ width: 16, height: 16, accentColor: "#5C9A3C", cursor: "pointer" }}
          />
          Carbonation checked
        </label>
      )}
      {batch.packagingRun && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ color: "#9BA88A", fontSize: 11.5 }}>
            Packaging into {batch.packagingRun.containerType} — started {formatHistoryStamp(batch.packagingRun.startedAt)}
          </span>
          <button
            onClick={() => onCancelPackagingRun(batch.id)}
            style={{ background: "none", border: "none", color: "#B5502F", cursor: "pointer", fontSize: 11.5, fontFamily: "'Inter', sans-serif", padding: 0 }}
          >
            Cancel run
          </button>
        </div>
      )}

      {stageIdx > 0 && batch.stage !== "Packaged" && (
        <button
          onClick={() => onMoveBack(batch.id)}
          style={{
            background: "none",
            border: "none",
            color: "#5C6B54",
            cursor: "pointer",
            fontSize: 12,
            fontFamily: "'Inter', sans-serif",
            padding: 0,
            marginBottom: 26,
            display: "block",
          }}
        >
          ← Move back to {stages[stageIdx - 1]}
        </button>
      )}

      {!isCider && (batch.stage === "Primary" || (batch.diacetylTests && batch.diacetylTests.length > 0)) && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>
              Diacetyl test
            </div>
            {batch.stage === "Primary" && (
              <button
                onClick={() => onLogDiacetylTest(batch)}
                style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}
              >
                Log test
              </button>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[...(batch.diacetylTests || [])].reverse().map((t) => (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "9px 12px",
                  background: "#F8F5EA",
                  border: `1px solid ${t.result === "pass" ? "#DDE0C8" : "#E3D3A0"}`,
                  borderRadius: 5,
                  fontSize: 13,
                }}
              >
                <span style={{ color: t.result === "pass" ? "#5C9A3C" : "#B5502F", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, textTransform: "uppercase" }}>
                  {t.result}
                </span>
                <span style={{ color: "#9BA88A", fontSize: 11.5 }}>{formatHistoryStamp(t.date)}</span>
              </div>
            ))}
            {(!batch.diacetylTests || batch.diacetylTests.length === 0) && (
              <div style={{ color: "#9BA88A", fontSize: 12.5 }}>
                No tests logged yet — needs at least one pass before this batch can move to Cooling.
              </div>
            )}
          </div>
        </div>
      )}

      {batch.splitTanks && batch.splitTanks.length > 0 ? (
        (["Brewing", "Primary", "Cooling"].includes(batch.stage) || batch.splitTanks.some((t) => (t.faults || []).length > 0)) && (
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
              Quality checklist — common faults
            </div>
            <div style={{ color: "#9BA88A", fontSize: 11.5, marginBottom: 10 }}>
              Tap a fault to cycle Low → Medium → High → off, per tank — one side developing a fault doesn't mean the other has too.
            </div>
            {batch.splitTanks.map((t) => (
              <SplitTankFaultsSection key={t.tankId} tank={t} batch={batch} onToggleFault={onToggleFault} />
            ))}
          </div>
        )
      ) : (
        (["Brewing", "Primary", "Cooling"].includes(batch.stage) || (batch.faults && batch.faults.length > 0)) && (() => {
        const active = currentFaults(batch);
        const history = [...(batch.faults || [])].sort((a, b) => (a.date < b.date ? 1 : -1));
        const hasHistory = new Set(history.map((f) => f.fault)).size < history.length; // more entries than unique faults = reassessed at least once
        return (
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
              Quality checklist — common faults
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {COMMON_FAULTS.map((fault) => {
                const existing = active.find((f) => f.fault === fault);
                const severity = existing ? existing.severity : null;
                const isToday = existing && existing.date === today();
                const color = severity ? FAULT_SEVERITY_COLOR[severity] : "#9BA88A";
                return (
                  <button
                    key={fault}
                    onClick={() => onToggleFault(batch.id, fault)}
                    title={existing && !isToday ? `Last noted ${formatHistoryStamp(existing.date)} — tap to reassess today` : undefined}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: severity ? `${color}22` : "#FFFFFF",
                      border: `1px solid ${severity ? color : "#DDE0C8"}`,
                      borderRadius: 20,
                      padding: "6px 12px",
                      cursor: "pointer",
                      fontSize: 12.5,
                      color: severity ? color : "#5C6B54",
                      fontFamily: "'Inter', sans-serif",
                    }}
                  >
                    {fault}
                    {severity && (
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.03em" }}>
                        {severity.toUpperCase()}
                        {!isToday ? "*" : ""}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div style={{ color: "#9BA88A", fontSize: 11.5, marginTop: 8 }}>
              Tap a fault to cycle Low → Medium → High → off. Each day gets its own fresh read — tapping today never overwrites an earlier day's note.
              {hasHistory && " * = from an earlier day."}
            </div>

            {hasHistory && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: "pointer", color: "#5C9A3C", fontSize: 12, fontFamily: "'Inter', sans-serif" }}>
                  View full fault history
                </summary>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
                  {history.map((f) => (
                    <div
                      key={f.id || `${f.fault}-${f.date}`}
                      style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 10px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 4 }}
                    >
                      <span style={{ color: "#2A3324" }}>{f.fault}</span>
                      <span style={{ color: FAULT_SEVERITY_COLOR[f.severity], fontFamily: "'JetBrains Mono', monospace" }}>{f.severity}</span>
                      <span style={{ color: "#9BA88A" }}>{formatHistoryStamp(f.date)}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        );
      })())}

      <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px", marginBottom: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: latestTankSettings || showTankSettingsForm ? 12 : 0 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>Tank settings</div>
          {!showTankSettingsForm && (
            <button
              onClick={() => setShowTankSettingsForm(true)}
              style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}
            >
              {latestTankSettings ? "Change" : "+ Set temp / pressure"}
            </button>
          )}
        </div>

        {latestTankSettings && !showTankSettingsForm && (
          <div style={{ display: "flex", gap: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Thermometer size={16} color="#4AA8C9" />
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, color: "#2A3324" }}>{latestTankSettings.setTemp}°C</span>
            </div>
            {latestTankSettings.setPressure != null && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Gauge size={16} color="#8E6FB5" />
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, color: "#2A3324" }}>
                  {latestTankSettings.setPressure} {latestTankSettings.pressureUnit}
                </span>
                <span style={{ color: "#9BA88A", fontSize: 12 }}>
                  (
                  {latestTankSettings.pressureUnit === "PSI"
                    ? `${psiToBar(latestTankSettings.setPressure).toFixed(2)} Bar`
                    : `${barToPsi(latestTankSettings.setPressure).toFixed(1)} PSI`}
                  )
                </span>
              </div>
            )}
          </div>
        )}

        {showTankSettingsForm && (
          <div>
            <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 100 }}>
                <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 4 }}>Set temperature (°C)</div>
                <input
                  type="number"
                  step="0.1"
                  value={setTempInput}
                  onChange={(e) => setSetTempInput(e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px 10px", color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 100 }}>
                <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 4 }}>Set pressure</div>
                <input
                  type="number"
                  step="0.1"
                  value={setPressureInput}
                  onChange={(e) => setSetPressureInput(e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px 10px", color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}
                />
              </div>
              <div>
                <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 4 }}>Unit</div>
                <div style={{ display: "flex", border: "1px solid #DDE0C8", borderRadius: 4, overflow: "hidden" }}>
                  {["PSI", "Bar"].map((u) => (
                    <button
                      key={u}
                      onClick={() => setPressureUnit(u)}
                      style={{
                        background: pressureUnit === u ? "#5C9A3C" : "#F5F1E4",
                        border: "none",
                        padding: "8px 12px",
                        color: pressureUnit === u ? "#16191A" : "#5C6B54",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => {
                  const setTemp = setTempInput.trim() ? Number(setTempInput) : null;
                  const setPressure = setPressureInput.trim() ? Number(setPressureInput) : null;
                  if (setTemp == null && setPressure == null) return;
                  onUpdateTankSettings(batch.id, { date: today(), setTemp, setPressure, pressureUnit });
                  setShowTankSettingsForm(false);
                }}
                style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "9px 16px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13.5, cursor: "pointer" }}
              >
                Save
              </button>
              <button
                onClick={() => setShowTankSettingsForm(false)}
                style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "9px 16px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 13.5, cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {batch.tankSettingsLog && batch.tankSettingsLog.length > 1 && !showTankSettingsForm && (
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", color: "#5C9A3C", fontSize: 12, fontFamily: "'Inter', sans-serif" }}>
              View setting history ({batch.tankSettingsLog.length})
            </summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
              {[...batch.tankSettingsLog]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((s) => (
                  <div
                    key={s.id}
                    style={{ display: "flex", gap: 14, fontSize: 12, padding: "6px 10px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 4 }}
                  >
                    <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace" }}>{formatHistoryStamp(s.date)}</span>
                    {s.setTemp != null && <span style={{ color: "#2A3324" }}>{s.setTemp}°C</span>}
                    {s.setPressure != null && (
                      <span style={{ color: "#2A3324" }}>
                        {s.setPressure} {s.pressureUnit}
                      </span>
                    )}
                  </div>
                ))}
            </div>
          </details>
        )}
      </div>

      {!isCider && (batch.stage === "Brewing" || batch.stage === "Primary") && (
        <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px", marginBottom: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: (batch.brewDays || []).length > 0 ? 10 : 0 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>
              Brew days — for blending multiple brews into this tank
            </div>
            <button
              onClick={onAddBrewDay}
              style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}
            >
              + Add another brew day
            </button>
          </div>
          {(batch.brewDays || []).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {batch.brewDays.map((bd) => (
                <div key={bd.id} style={{ padding: "8px 10px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 4, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#2A3324" }}>{formatHistoryStamp(bd.date)}{bd.og ? ` — OG ${bd.og.toFixed(3)}` : ""}</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C9A3C" }}>+{bd.volume}L</span>
                  </div>
                  {bd.ingredients.length > 0 && (
                    <div style={{ color: "#9BA88A", marginTop: 3 }}>
                      {bd.ingredients.map((i) => `${i.qty}${i.unit} ${i.name}`).join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(() => {
        const recipe = (recipes || []).find((r) => r.id === batch.recipeId);
        if (!recipe || !recipe.schedule || recipe.schedule.length === 0 || !recipe.volume) return null;
        const ratio = batch.volume / recipe.volume;
        const scaledItems = [...recipe.schedule].sort(compareScheduleItems).map((s) => ({
          ...s,
          scaledAmount: Math.round((Number(s.amount) || 0) * ratio * 1000) / 1000,
        }));
        return (
          <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px", marginBottom: 22 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>
              Recipe schedule — scaled for this batch's {batch.volume}L
            </div>
            {Math.abs(ratio - 1) > 0.01 && (
              <div style={{ color: "#9BA88A", fontSize: 11.5, marginBottom: 10 }}>
                The recipe's base amounts are for {recipe.volume}L — these are scaled up to match this batch's actual volume, including any merged brew days.
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              {scaledItems.map((s) => (
                <div key={s.id} style={{ padding: "9px 12px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, fontSize: 13, color: "#2A3324" }}>
                  {s.label} <span style={{ color: "#5C6B54", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }}>({s.scaledAmount} {s.unit})</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {(() => {
        if (!batch.splitGroupId) return null;
        const siblings = (allBatches || []).filter((b) => b.id !== batch.id && b.splitGroupId === batch.splitGroupId);
        if (siblings.length === 0) return null;
        return (
          <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px", marginBottom: 22 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
              Brewed with — same brew day, split into separate tanks
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {siblings.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onOpenBatch(s.id)}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 12px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, cursor: "pointer", textAlign: "left", width: "100%", boxSizing: "border-box" }}
                >
                  <span style={{ color: "#2A3324", fontSize: 13 }}>{s.name}</span>
                  <span style={{ color: "#9BA88A", fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace" }}>{s.tankName} · {s.stage}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {batch.splitTanks && batch.splitTanks.length > 0 && isOwner && (
        <div style={{ background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 6, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ color: "#7A3E1D", fontSize: 12.5, marginBottom: 8 }}>
            This is an older-style split — each tank still shares one record. Converting makes each tank its own fully independent batch, carrying forward everything already logged for it. This can't be undone.
          </div>
          <button
            onClick={() => onConvertSplitTanks(batch)}
            style={{ background: "#B5502F", border: "none", borderRadius: 5, padding: "9px 14px", color: "#FFFFFF", fontFamily: "'Inter', sans-serif", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
          >
            Convert to separate batches
          </button>
        </div>
      )}

      {batch.splitTanks && batch.splitTanks.length > 0 ? (
        <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px", marginBottom: 22 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
            Split tank additions — hops, fruit, or anything else added to one side differently
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {batch.splitTanks.map((t) => (
              <div key={t.tankId} style={{ border: "1px solid #EBE8D6", borderRadius: 5, padding: "10px 12px", background: "#F8F5EA" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: (t.additions || []).length > 0 ? 8 : 0 }}>
                  <span style={{ color: "#2A3324", fontSize: 13, fontFamily: "'Inter', sans-serif" }}>{t.tankName} ({t.volume}L)</span>
                  <button
                    onClick={() => onAddSplitTankIngredient(t)}
                    style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}
                  >
                    + Add ingredient
                  </button>
                </div>
                {(t.additions || []).length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {t.additions.map((a) => (
                      <div key={a.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 8px", background: "#FFFFFF", border: "1px solid #EBE8D6", borderRadius: 4 }}>
                        <span style={{ color: "#2A3324" }}>{a.name}{a.note ? ` — ${a.note}` : ""}</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A" }}>
                          {a.qty} {a.unit} · {formatHistoryStamp(a.date)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px", marginBottom: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: (batch.batchAdditions || []).length > 0 ? 10 : 0 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>
              Additions — hops, fruit, or anything else added mid-fermentation
            </div>
            <button
              onClick={onAddBatchIngredient}
              style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}
            >
              + Add ingredient
            </button>
          </div>
          {(batch.batchAdditions || []).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {batch.batchAdditions.map((a) => (
                <div key={a.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 8px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 4 }}>
                  <span style={{ color: "#2A3324" }}>{a.name}{a.note ? ` — ${a.note}` : ""}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A" }}>
                    {a.qty} {a.unit} · {formatHistoryStamp(a.date)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {["Primary", "Cooling", "Brite Tank", "Aging"].includes(batch.stage) && (
        <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px", marginBottom: 22 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>Yeast</div>
          {batch.pitchedYeastHarvestId &&
            (() => {
              const pitched = (yeastHarvests || []).find((h) => h.id === batch.pitchedYeastHarvestId);
              return pitched ? (
                <div style={{ color: "#5C6B54", fontSize: 12.5, marginBottom: 10 }}>
                  Pitched with a harvested strain — <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#2A3324" }}>Generation {pitched.generation}</span>
                </div>
              ) : null;
            })()}
          <button
            onClick={onOpenHarvestYeast}
            style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "9px 14px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
          >
            Harvest yeast from this batch
          </button>
        </div>
      )}

      {batch.splitTanks && batch.splitTanks.length > 0 ? (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
            Readings — each tank ferments on its own, so tracked separately
          </div>
          {batch.splitTanks.map((t) => (
            <SplitTankReadingsSection key={t.tankId} tank={t} batch={batch} onLogReading={(b, tId, tName) => onLogReading(b, tId, tName)} onDeleteReading={onDeleteReading} />
          ))}
        </div>
      ) : (
        <>
          {chartData.length > 1 && (
            <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "16px 12px 10px", marginBottom: 22 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10, marginLeft: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <TrendingDown size={13} /> Gravity trend
              </div>
              <TrendChart points={chartData} valueKey="gravity" color="#5C9A3C" formatValue={(v) => v.toFixed(3)} />
            </div>
          )}

          {chartData.filter((d) => d.temp != null).length > 1 && (
            <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "16px 12px 10px", marginBottom: 22 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10, marginLeft: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <Thermometer size={13} /> Temperature trend
              </div>
              <TrendChart points={chartData} valueKey="temp" color="#4AA8C9" formatValue={(v) => `${v.toFixed(1)}°`} />
            </div>
          )}

          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
            Reading log
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[...batch.readings].reverse().map((r) => (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  gap: 14,
                  alignItems: "baseline",
                  padding: "9px 12px",
                  background: "#F8F5EA",
                  border: "1px solid #EBE8D6",
                  borderRadius: 5,
                  fontSize: 13,
                }}
              >
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", width: 62, flexShrink: 0 }}>{r.date.slice(5)}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#2A3324", width: 60, flexShrink: 0 }}>{r.gravity.toFixed(3)}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54", width: 42, flexShrink: 0 }}>{r.temp}°C</span>
                {r.ph != null && (
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54", width: 48, flexShrink: 0 }}>pH {r.ph.toFixed(2)}</span>
                )}
                {r.note && <span style={{ flex: 1, color: "#5C6B54", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.note}</span>}
                {batch.readings.length > 1 && (
                  <button
                    onClick={() => onDeleteReading(batch.id, r.id)}
                    aria-label="Delete reading"
                    style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 6, marginLeft: "auto", flexShrink: 0 }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginTop: 26, marginBottom: 10 }}>
        Notes
      </div>
      {batch.splitTanks && batch.splitTanks.length > 0 ? (
        <div style={{ marginBottom: 26 }}>
          {batch.splitTanks.map((t) => (
            <SplitTankNotesSection key={t.tankId} tank={t} batch={batch} onAddNote={onAddNote} onDeleteNote={onDeleteNote} />
          ))}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              type="text"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && noteText.trim()) {
                  onAddNote(batch.id, noteText.trim(), undefined, noteDate);
                  setNoteText("");
                  setNoteDate(today());
                }
              }}
              placeholder="Jot something down — brew day, fermentation, packaging, anything"
              style={{
                flex: 1,
                minWidth: 0,
                boxSizing: "border-box",
                background: "#F5F1E4",
                border: "1px solid #DDE0C8",
                borderRadius: 4,
                padding: "9px 10px",
                color: "#2A3324",
                fontFamily: "'Inter', sans-serif",
                fontSize: 13.5,
              }}
            />
            <button
              onClick={() => {
                if (!noteText.trim()) return;
                onAddNote(batch.id, noteText.trim(), undefined, noteDate);
                setNoteText("");
                setNoteDate(today());
              }}
              disabled={!noteText.trim()}
              style={{
                background: noteText.trim() ? "#5C9A3C" : "#E8E4D4",
                border: "none",
                borderRadius: 5,
                padding: "0 16px",
                color: noteText.trim() ? "#16191A" : "#A3AC94",
                fontFamily: "'Oswald', sans-serif",
                fontWeight: 500,
                fontSize: 13,
                cursor: noteText.trim() ? "pointer" : "default",
                flexShrink: 0,
              }}
            >
              Add
            </button>
          </div>
          {(noteText.trim() || noteDate < today()) && <div style={{ marginBottom: 10 }}><BackdateField value={noteDate} onChange={setNoteDate} label="Note date" /></div>}
          {(batch.notes || []).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 26 }}>
              {[...batch.notes].reverse().map((n) => (
                <div
                  key={n.id}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    padding: "9px 12px",
                    background: "#F8F5EA",
                    border: "1px solid #EBE8D6",
                    borderRadius: 5,
                    fontSize: 13,
                  }}
                >
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 11, flexShrink: 0, marginTop: 2 }}>
                    {formatHistoryStamp(n.date)}
                  </span>
                  <span style={{ flex: 1, color: "#2A3324", lineHeight: 1.4, whiteSpace: "pre-wrap", overflowWrap: "break-word" }}>{n.text}</span>
                  <button
                    onClick={() => onDeleteNote(batch.id, n.id)}
                    aria-label="Delete note"
                    style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 4, flexShrink: 0 }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {batch.stage === "Aging" && currentTank?.type === "Barrel" && (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 20,
            padding: "12px 14px",
            background: "#FFFFFF",
            border: "1px solid #DDE0C8",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          <span>
            <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13.5, color: "#2A3324" }}>Still actively fermenting</div>
            <div style={{ color: "#5C6B54", fontSize: 12, marginTop: 2 }}>
              Turn this off once it's settled into quiet aging — matters most for wild or spontaneous fermentation straight from the kettle.
            </div>
          </span>
          <input
            type="checkbox"
            checked={!!batch.stillFermenting}
            onChange={(e) => onSetStillFermenting(batch.id, e.target.checked)}
            style={{ width: 18, height: 18, accentColor: "#E08A3C", cursor: "pointer", flexShrink: 0 }}
          />
        </label>
      )}

      {(batch.stage === "Aging" || (batch.tastingLog || []).length > 0) && (
        <div style={{ marginBottom: 26 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>Tasting log</div>
            {batch.stage === "Aging" && (
              <button
                onClick={onOpenTastingLog}
                style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}
              >
                + Log a tasting
              </button>
            )}
          </div>
          {(batch.tastingLog || []).length === 0 ? (
            <div style={{ color: "#9BA88A", fontSize: 13 }}>Nothing logged yet — since this could sit here for months, it's worth checking in on periodically.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[...batch.tastingLog].reverse().map((t) => (
                <div key={t.id} style={{ padding: "10px 12px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 6 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#9BA88A", marginBottom: 6 }}>{t.date}</div>
                  {t.tags && t.tags.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: t.notes ? 6 : 0 }}>
                      {t.tags.map((tag) => {
                        const isOff = TASTING_TAGS["Off-flavors"].includes(tag);
                        return (
                          <span
                            key={tag}
                            style={{
                              background: isOff ? "#FBE5D2" : "#EBF3E4",
                              border: `1px solid ${isOff ? "#E3B37A" : "#5C9A3C"}`,
                              borderRadius: 20,
                              padding: "3px 9px",
                              color: isOff ? "#7A3E1D" : "#2A3324",
                              fontSize: 11.5,
                            }}
                          >
                            {tag}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {t.notes && <div style={{ color: "#2A3324", fontSize: 13, lineHeight: 1.4 }}>{t.notes}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(["Brite Tank", "Aging", "Packaged"].includes(batch.stage) || (batch.sensoryScores || []).length > 0) && (
        <div style={{ marginBottom: 26 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>Sensory scores</div>
            <button
              onClick={onOpenSensoryScore}
              style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}
            >
              + Score this batch
            </button>
          </div>
          {(batch.sensoryScores || []).length === 0 ? (
            <div style={{ color: "#9BA88A", fontSize: 13 }}>No scores yet — a few tasters scoring the same batch builds a real picture of consistency over time.</div>
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
                {SENSORY_CATEGORIES.map((c) => {
                  const values = batch.sensoryScores.map((s) => s.scores?.[c.key]).filter((v) => v != null);
                  const avg = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
                  return (
                    <div key={c.key} style={{ background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 6, padding: "8px 12px", minWidth: 80 }}>
                      <div style={{ fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>{c.label}</div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: "#2A3324" }}>{avg != null ? avg.toFixed(1) : "—"}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[...batch.sensoryScores].reverse().map((s) => (
                  <div key={s.id} style={{ padding: "10px 12px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ color: "#2A3324", fontSize: 13, fontWeight: 600 }}>{s.tasterName}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#9BA88A" }}>{s.date}</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, color: "#5C6B54", fontSize: 12 }}>
                      {SENSORY_CATEGORIES.map((c) => (
                        <span key={c.key}>{c.label}: {s.scores?.[c.key] ?? "—"}</span>
                      ))}
                    </div>
                    {s.notes && <div style={{ color: "#2A3324", fontSize: 13, lineHeight: 1.4, marginTop: 6 }}>{s.notes}</div>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ marginBottom: 26 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>Lab measurements</div>
          <button
            onClick={onOpenLabMeasurement}
            style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}
          >
            + Log a measurement
          </button>
        </div>
        {(batch.labMeasurements || []).length === 0 ? (
          <div style={{ color: "#9BA88A", fontSize: 13 }}>No lab measurements yet — gravity, pH, dissolved oxygen, or CO2 volumes, tracked separately from sensory scores.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...batch.labMeasurements].reverse().map((m) => (
              <div key={m.id} style={{ padding: "10px 12px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ color: "#2A3324", fontSize: 13, fontWeight: 600 }}>{m.measuredBy}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#9BA88A" }}>{m.date}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, color: "#5C6B54", fontSize: 12 }}>
                  {m.gravity != null && <span>SG: {Number(m.gravity).toFixed(3)}</span>}
                  {m.ph != null && <span>pH: {m.ph}</span>}
                  {m.dissolvedOxygen != null && <span>DO: {m.dissolvedOxygen} ppb</span>}
                  {m.co2Volumes != null && <span>CO2: {m.co2Volumes} vol</span>}
                </div>
                {m.notes && <div style={{ color: "#2A3324", fontSize: 13, lineHeight: 1.4, marginTop: 6 }}>{m.notes}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {(["Brite Tank", "Aging", "Packaged"].includes(batch.stage) || batch.qcApproval) && (
        <div style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>Release sign-off</div>
          {batch.qcApproval ? (
            <div style={{ background: "#EBF3E4", border: "1px solid #5C9A3C", borderRadius: 6, padding: "12px 14px" }}>
              <div style={{ color: "#2A3324", fontSize: 13.5 }}>Approved for release by {batch.qcApproval.approvedBy}</div>
              <div style={{ color: "#5C6B54", fontSize: 12, marginTop: 2 }}>{batch.qcApproval.date}</div>
              {batch.qcApproval.notes && <div style={{ color: "#2A3324", fontSize: 13, marginTop: 6 }}>{batch.qcApproval.notes}</div>}
            </div>
          ) : (
            <button
              onClick={onOpenQcApproval}
              style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "11px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 13, cursor: "pointer", width: "100%" }}
            >
              Sign off this batch for release
            </button>
          )}
        </div>
      )}

      {currentTank?.type === "Barrel" && (batch.stage === "Aging" || (batch.volumeTopups || []).length > 0) && (
        <div style={{ marginBottom: 26 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>Volume top-ups</div>
            {batch.stage === "Aging" && (
              <button
                onClick={onOpenTopUp}
                style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}
              >
                + Log a top-up
              </button>
            )}
          </div>
          {(batch.volumeTopups || []).length === 0 ? (
            <div style={{ color: "#9BA88A", fontSize: 13 }}>
              Nothing logged yet — barrels lose a little to evaporation over time (the "angel's share"), worth checking in on periodically.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[...batch.volumeTopups].reverse().map((t) => (
                <div
                  key={t.id}
                  style={{ display: "flex", gap: 14, alignItems: "baseline", padding: "9px 12px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, fontSize: 13 }}
                >
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", width: 62, flexShrink: 0 }}>{formatHistoryStamp(t.date)}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#2A3324", flexShrink: 0 }}>+{t.volume}L</span>
                  {t.note && <span style={{ flex: 1, color: "#5C6B54", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.note}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => window.print()}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          background: "none",
          border: "1px solid #DDE0C8",
          borderRadius: 5,
          padding: "11px",
          color: "#5C6B54",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          cursor: "pointer",
          marginTop: 26,
        }}
      >
        <FileText size={14} /> Print / Save as PDF
      </button>

      {onDeleteBatch && (
        <button
          onClick={() => onDeleteBatch(batch)}
          style={{
            width: "100%",
            background: "none",
            border: "1px solid #E3D3A0",
            borderRadius: 5,
            padding: "11px",
            color: "#5C9A3C",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            cursor: "pointer",
            marginTop: 10,
          }}
        >
          Delete batch
        </button>
      )}

      <div className="bp-print-sheet" style={{ display: "none" }}>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, margin: "0 0 2px" }}>{batch.name}</h1>
        <div style={{ color: "#555", fontSize: 13, marginBottom: 16 }}>
          Batch #{batch.number} · {batch.style} · {batch.volume}L · {batchTankSummary(batch) || "No tank assigned"}
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16, fontSize: 13 }}>
          <tbody>
            <tr><td style={{ padding: "4px 0", color: "#555", width: "40%" }}>Brew date</td><td>{batch.startDate}</td></tr>
            <tr><td style={{ padding: "4px 0", color: "#555" }}>Recipe</td><td>{batch.recipeName || "—"}</td></tr>
            <tr><td style={{ padding: "4px 0", color: "#555" }}>Mash pH</td><td>{batch.mashPh != null ? batch.mashPh.toFixed(2) : "—"}</td></tr>
            <tr><td style={{ padding: "4px 0", color: "#555" }}>Mash temp</td><td>{batch.mashTemp != null ? `${batch.mashTemp.toFixed(1)}°C` : "—"}</td></tr>
            <tr><td style={{ padding: "4px 0", color: "#555" }}>Target OG / FG</td><td>{batch.og != null ? batch.og.toFixed(3) : "—"} / {batch.fg != null ? batch.fg.toFixed(3) : "—"}</td></tr>
            <tr><td style={{ padding: "4px 0", color: "#555" }}>Actual FG (latest reading)</td><td>{latest.gravity != null ? latest.gravity.toFixed(3) : "—"}</td></tr>
            <tr><td style={{ padding: "4px 0", color: "#555" }}>Attenuation</td><td>{batch.og != null && latest.gravity != null ? `${pct.toFixed(0)}%` : "—"}</td></tr>
            <tr><td style={{ padding: "4px 0", color: "#555" }}>ABV (current)</td><td>{calcABV(batch.og, latest.gravity) != null ? `${calcABV(batch.og, latest.gravity).toFixed(1)}%` : "—"}</td></tr>
            <tr><td style={{ padding: "4px 0", color: "#555" }}>Days in tank</td><td>{days}</td></tr>
            {isOwner && <tr><td style={{ padding: "4px 0", color: "#555" }}>Ingredient cost</td><td>{batch.ingredientCost ? `$${batch.ingredientCost.toFixed(2)}` : "—"}</td></tr>}
          </tbody>
        </table>

        {batch.ingredients && batch.ingredients.length > 0 && (
          <>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Ingredients</div>
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16, fontSize: 12.5 }}>
              <tbody>
                {batch.ingredients.map((ing, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #ddd" }}>
                    <td style={{ padding: "4px 0" }}>{ing.name}</td>
                    <td style={{ padding: "4px 0", textAlign: "right" }}>{ing.qty} {ing.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {batch.readings && batch.readings.length > 0 && (
          <>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Gravity log</div>
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16, fontSize: 12.5 }}>
              <tbody>
                {batch.readings.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #ddd" }}>
                    <td style={{ padding: "4px 0" }}>{r.date}</td>
                    <td style={{ padding: "4px 0" }}>{r.gravity.toFixed(3)}</td>
                    <td style={{ padding: "4px 0" }}>{r.temp}°C</td>
                    <td style={{ padding: "4px 0", color: "#555" }}>{r.note || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {batch.packaging && (
          <>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Packaging</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <tbody>
                {CONTAINERS.filter((c) => aggregatePackagingCounts(batch)[c.key] > 0).map((c) => (
                  <tr key={c.key}>
                    <td style={{ padding: "4px 0" }}>{c.label}</td>
                    <td style={{ padding: "4px 0", textAlign: "right" }}>{aggregatePackagingCounts(batch)[c.key]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
