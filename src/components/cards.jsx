import { AlertTriangle } from "lucide-react";
import { AgingTankVesselIcon, BarrelVesselIcon, BrewDayVesselIcon } from "./tanks";
import { attenuation } from "../lib/brewing";
import { CATEGORY_COLOR, STEP_FOR_UNIT, latestReading } from "../lib/config";
import { BREW_STAGE_INFO, CONTAINERS, STAGE_COLOR, aggregatePackagingCounts, batchTankIds, batchTankSummary, formatQty, inventoryItemValue, remainingVolume, totalPackagedVolume } from "../lib/production";
import { daysBetween, today } from "../lib/utils";

export function Tank({ batch, vesselType, tankCapacity }) {
  const color = STAGE_COLOR[batch.stage] || "#5C9A3C";
  // Same fill-level meaning as the tank wall on Home — how full the
  // vessel physically is (volume against capacity), not fermentation
  // progress. A batch that just started is full of liquid even at 0%
  // attenuation, and should look full here too, not nearly empty.
  const fillPct = tankCapacity > 0 ? Math.max(4, Math.min(100, Math.round((batch.volume / tankCapacity) * 100))) : 50;

  if (vesselType === "Barrel") return <BarrelVesselIcon fermenting={!!batch.stillFermenting} size={46} uid={batch.id} />;
  if (vesselType === "Aging Tank") return <AgingTankVesselIcon size={46} uid={batch.id} />;

  const clipId = `clip-${batch.id}`;
  const gradId = `tank-grad-${batch.id}`;
  const steelId = `tank-steel-${batch.id}`;
  const isBrite = vesselType === "Brite Tank";
  // Same two vessel shapes as the tank wall on Home — a fermenter's real
  // cone, or a brite tank's flat-bottomed cylinder — at the exact same
  // 120x200 proportions, just rendered smaller.
  const bodyPath = isBrite
    ? "M10 20 Q10 10 20 10 H100 Q110 10 110 20 V180 Q110 190 100 190 H20 Q10 190 10 180 Z"
    : "M10 10 H110 V140 L60 190 L10 140 Z";
  const surfaceY = 10 + (180 - 10) * (1 - fillPct / 100);
  const fermenting = !isBrite && (batch.stage === "Brewing" || batch.stage === "Primary");
  const bubbles = fermenting ? [30, 60, 90].map((x, i) => ({ x, delay: i * 0.6, dur: 1.9 + (i % 2) * 0.4 })) : [];

  return (
    <div style={{ width: 46, height: 77, position: "relative", flexShrink: 0 }}>
      <svg width="46" height="77" viewBox="0 0 120 200">
        <defs>
          <clipPath id={clipId}>
            <path d={bodyPath} />
          </clipPath>
          <linearGradient id={steelId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#E4E0D0" />
            <stop offset="35%" stopColor="#F8F6EE" />
            <stop offset="55%" stopColor="#FDFCF7" />
            <stop offset="100%" stopColor="#DDD8C4" />
          </linearGradient>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.55" />
            <stop offset="100%" stopColor={color} stopOpacity="0.9" />
          </linearGradient>
        </defs>

        <rect x="24" y="2" width="72" height="9" rx="4" fill={`url(#${steelId})`} stroke="#C9D1AC" strokeWidth="1.5" />
        <path d={bodyPath} fill={`url(#${steelId})`} stroke="#C9D1AC" strokeWidth="2.5" />

        <g clipPath={`url(#${clipId})`}>
          <rect x="0" y={surfaceY} width="120" height="200" fill={`url(#${gradId})`} />
          {fermenting &&
            bubbles.map((b, i) => (
              <circle key={i} cx={b.x} cy="185" r="2.6" fill="#FFFFFF" opacity="0.6">
                <animate attributeName="cy" from="185" to={surfaceY + 6} dur={`${b.dur}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
                <animate attributeName="opacity" values="0;0.65;0" dur={`${b.dur}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
              </circle>
            ))}
        </g>

        <path d={bodyPath} fill="none" stroke="#C9D1AC" strokeWidth="2.5" />
      </svg>
    </div>
  );
}

export function StagePill({ stage }) {
  return (
    <span
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: STAGE_COLOR[stage],
        border: `1px solid ${STAGE_COLOR[stage]}`,
        borderRadius: 3,
        padding: "3px 7px",
        display: "inline-block",
      }}
    >
      {stage}
    </span>
  );
}

export function BatchCard({ batch, onOpen, tanks }) {
  const latest = latestReading(batch);
  const pct = attenuation(batch.og, batch.fg, latest.gravity);
  const days = daysBetween(batch.startDate, today());
  const vesselType = tanks ? tanks.find((t) => t.id === batch.tankId)?.type : null;
  const tankCapacity = tanks ? batchTankIds(batch).reduce((sum, id) => sum + (tanks.find((t) => t.id === id)?.capacity || 0), 0) : 0;
  const isScheduled = batch.startDate > today();
  const inMashTun = batch.stage === "Brewing" && vesselType === "Mash Tun";
  const inKettle = batch.stage === "Brewing" && vesselType === "Kettle";
  const brewStageInfo = (inMashTun || inKettle) && batch.brewStage && BREW_STAGE_INFO[batch.brewStage] ? BREW_STAGE_INFO[batch.brewStage] : null;
  return (
    <button
      onClick={() => onOpen(batch.id)}
      style={{
        display: "flex",
        gap: 16,
        alignItems: "center",
        background: isScheduled ? "#FBF8F0" : "#FFFFFF",
        border: isScheduled ? "1px dashed #B8AD8A" : "1px solid #DDE0C8",
        borderRadius: 6,
        padding: "16px 18px",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = isScheduled ? "#9B8F6F" : "#C9D1AC")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = isScheduled ? "#B8AD8A" : "#DDE0C8")}
    >
      {inMashTun || inKettle ? (
        <BrewDayVesselIcon isKettle={inKettle} recirculating={batch.brewStage === "Recirculating"} uid={batch.id} size={46} />
      ) : (
        <Tank batch={batch} vesselType={vesselType} tankCapacity={tankCapacity} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                color: "#9BA88A",
                fontSize: 13,
              }}
            >
              #{batch.number}
            </span>
            <h3
              style={{
                fontFamily: "'Oswald', sans-serif",
                fontWeight: 500,
                fontSize: 18,
                color: "#2A3324",
                margin: 0,
                textOverflow: "ellipsis",
                overflow: "hidden",
                whiteSpace: "nowrap",
              }}
            >
              {batch.name}
            </h3>
          </div>
          {isScheduled ? (
            <span
              style={{
                flexShrink: 0,
                background: "#C9BD98",
                color: "#3F3826",
                borderRadius: 20,
                padding: "3px 10px",
                fontSize: 11,
                fontFamily: "'Inter', sans-serif",
                fontWeight: 500,
              }}
            >
              Scheduled
            </span>
          ) : brewStageInfo ? (
            <span
              style={{
                flexShrink: 0,
                background: `${brewStageInfo.color}22`,
                border: `1px solid ${brewStageInfo.color}`,
                color: brewStageInfo.color,
                borderRadius: 20,
                padding: "2px 10px",
                fontSize: 11,
                fontFamily: "'Inter', sans-serif",
                fontWeight: 500,
              }}
            >
              {brewStageInfo.label}
            </span>
          ) : (
            <StagePill stage={batch.stage} />
          )}
        </div>
        <div style={{ color: "#5C6B54", fontSize: 13, marginTop: 2 }}>
          {batch.style}{batchTankSummary(batch) ? ` · ${batchTankSummary(batch)}` : ""}
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 10, fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: "#5C6B54" }}>
          {latest.gravity != null ? (
            <>
              <span>SG {latest.gravity.toFixed(3)}</span>
              <span>{latest.temp}°C</span>
              <span>{days}d</span>
              <span style={{ color: STAGE_COLOR[batch.stage] }}>{pct.toFixed(0)}% attn</span>
            </>
          ) : (
            <span style={{ color: "#9BA88A" }}>Scheduled for {batch.startDate}</span>
          )}
        </div>
        {batch.packaging && (() => {
          const totals = aggregatePackagingCounts(batch);
          const rem = remainingVolume(batch);
          const pctPackaged = Math.min(100, Math.round((totalPackagedVolume(batch) / batch.volume) * 100));
          const parts = CONTAINERS.filter((c) => totals[c.key] > 0).map((c) => `${totals[c.key]}× ${c.shortLabel}`);
          if (rem > 0) parts.push(`${rem}L in tank`);
          return (
            <div style={{ marginTop: 8 }}>
              <div style={{ height: 5, background: "#DDE0C8", borderRadius: 3, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${pctPackaged}%`,
                    background: rem > 0 ? "#D4A24C" : "#D9A441",
                    borderRadius: 3,
                  }}
                />
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: "#9BA88A", marginTop: 5 }}>
                {pctPackaged}% packaged{parts.length > 0 ? " · " : ""}
                {parts.join(" · ")}
              </div>
            </div>
          );
        })()}
      </div>
    </button>
  );
}

export function InventoryItemCard({ item, onAdjust, onOpen, suppliers, isOwner }) {
  const low = item.qty <= item.threshold;
  const step = STEP_FOR_UNIT[item.unit] ?? 1;
  const supplierName = item.supplierId ? suppliers.find((s) => s.id === item.supplierId)?.name : null;
    return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: "#FFFFFF",
        border: `1px solid ${low ? "#E3D3A0" : "#DDE0C8"}`,
        borderRadius: 6,
        padding: "13px 16px",
      }}
    >
      <button
        onClick={() => onOpen(item.id)}
        style={{ flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3
            style={{
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 16,
              color: "#2A3324",
              margin: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.name}
          </h3>
          {low && <AlertTriangle size={13} color="#5C9A3C" />}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10.5,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: CATEGORY_COLOR[item.category],
            }}
          >
            {item.category}
          </span>
          {item.lots && item.lots.length > 0 && (
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: "#9BA88A" }}>
              · lot {item.lots[item.lots.length - 1].lotNumber}
              {item.lots.length > 1 ? ` (+${item.lots.length - 1})` : ""}
            </span>
          )}
          {supplierName && (
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: "#9BA88A" }}>
              · {supplierName}
            </span>
          )}
          {isOwner && inventoryItemValue(item) > 0 && (
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: "#5C9A3C" }}>
              · ${inventoryItemValue(item).toFixed(2)}
            </span>
          )}
        </div>
      </button>
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 14,
            color: low ? "#5C9A3C" : "#2A3324",
            width: 68,
            textAlign: "center",
          }}
        >
          {formatQty(item.qty, item.unit)}
        </span>
      </div>
    </div>
  );
}
