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
