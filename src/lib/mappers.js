// Converts between the camelCase shapes the UI uses and the snake_case
// columns Postgres/Supabase uses. Keeping this in one place means the
// components never need to know about the database at all.

export function rowToBatch(row) {
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    style: row.style,
    volume: row.volume,
    og: row.og,
    fg: row.fg,
    mashPh: row.mash_ph,
    preBoilGravity: row.pre_boil_gravity,
    topUpWater: row.top_up_water,
    stage: row.stage,
    startDate: row.start_date,
    recipeId: row.recipe_id,
    recipeName: row.recipe_name,
    tankId: row.tank_id,
    tankName: row.tank_name,
    splitTanks: row.split_tanks || [],
    readings: row.readings || [],
    ingredients: row.ingredients || [],
    packaging: row.packaging || null,
    schedule: row.schedule || [],
  };
}

export function batchToRow(batch, userId, companyId) {
  return {
    id: batch.id,
    user_id: userId,
    company_id: companyId,
    number: batch.number,
    name: batch.name,
    style: batch.style,
    volume: batch.volume,
    og: batch.og,
    fg: batch.fg,
    mash_ph: batch.mashPh ?? null,
    pre_boil_gravity: batch.preBoilGravity ?? null,
    top_up_water: batch.topUpWater ?? null,
    stage: batch.stage,
    start_date: batch.startDate,
    recipe_id: batch.recipeId ?? null,
    recipe_name: batch.recipeName ?? null,
    tank_id: batch.tankId ?? null,
    tank_name: batch.tankName ?? null,
    split_tanks: batch.splitTanks || [],
    readings: batch.readings || [],
    ingredients: batch.ingredients || [],
    packaging: batch.packaging ?? null,
    schedule: batch.schedule || [],
  };
}

export function rowToInventoryItem(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    qty: row.qty,
    unit: row.unit,
    threshold: row.threshold,
    lots: row.lots || [],
    history: row.history || [],
  };
}

export function inventoryItemToRow(item, userId, companyId) {
  return {
    id: item.id,
    user_id: userId,
    company_id: companyId,
    name: item.name,
    category: item.category,
    qty: item.qty,
    unit: item.unit,
    threshold: item.threshold,
    lots: item.lots || [],
    history: item.history || [],
  };
}

export function rowToPO(row) {
  return {
    id: row.id,
    poNumber: row.po_number,
    supplier: row.supplier,
    orderDate: row.order_date,
    receivedDate: row.received_date,
    status: row.status,
    lines: row.lines || [],
  };
}

export function poToRow(po, userId, companyId) {
  return {
    id: po.id,
    user_id: userId,
    company_id: companyId,
    po_number: po.poNumber,
    supplier: po.supplier,
    order_date: po.orderDate,
    received_date: po.receivedDate ?? null,
    status: po.status,
    lines: po.lines || [],
  };
}

export function rowToRecipe(row) {
  return {
    id: row.id,
    name: row.name,
    style: row.style,
    volume: row.volume,
    og: row.og,
    fg: row.fg,
    ingredients: row.ingredients || [],
    schedule: row.schedule || [],
    familyId: row.family_id || row.id,
    version: row.version || 1,
    createdAt: row.created_at || null,
    isActive: row.is_active !== false,
  };
}

export function recipeToRow(recipe, userId, companyId) {
  return {
    id: recipe.id,
    user_id: userId,
    company_id: companyId,
    name: recipe.name,
    style: recipe.style,
    volume: recipe.volume,
    og: recipe.og,
    fg: recipe.fg,
    ingredients: recipe.ingredients || [],
    schedule: recipe.schedule || [],
    is_active: recipe.isActive !== false,
    family_id: recipe.familyId,
    version: recipe.version || 1,
  };
}

export function rowToProfile(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    role: row.role,
  };
}

export function rowToTank(row) {
  return {
    id: row.id,
    name: row.name,
    capacity: row.capacity,
  };
}

export function tankToRow(tank, companyId) {
  return {
    id: tank.id,
    company_id: companyId,
    name: tank.name,
    capacity: tank.capacity,
  };
}

export function rowToStockTake(row) {
  return {
    id: row.id,
    date: row.date,
    userName: row.user_name,
    lines: row.lines || [],
    createdAt: row.created_at || null,
  };
}

export function stockTakeToRow(stockTake, userId, companyId) {
  return {
    id: stockTake.id,
    company_id: companyId,
    user_id: userId,
    user_name: stockTake.userName,
    date: stockTake.date,
    lines: stockTake.lines || [],
  };
}

export function rowToFoodSafetyRecord(row) {
  return {
    id: row.id,
    category: row.category,
    frequency: row.frequency,
    date: row.date,
    userName: row.user_name,
    items: row.items || [],
    equipmentName: row.equipment_name,
    result: row.result,
    dueDate: row.due_date,
    staffName: row.staff_name,
    topic: row.topic,
    trainedBy: row.trained_by,
    staffConfirmed: row.staff_confirmed || false,
    notes: row.notes,
    createdAt: row.created_at || null,
  };
}

export function foodSafetyRecordToRow(record, userId, companyId) {
  return {
    id: record.id,
    company_id: companyId,
    user_id: userId,
    user_name: record.userName,
    category: record.category,
    frequency: record.frequency || null,
    date: record.date,
    items: record.items || [],
    equipment_name: record.equipmentName || null,
    result: record.result || null,
    due_date: record.dueDate || null,
    staff_name: record.staffName || null,
    topic: record.topic || null,
    trained_by: record.trainedBy || null,
    staff_confirmed: record.staffConfirmed || false,
    notes: record.notes || null,
  };
}
