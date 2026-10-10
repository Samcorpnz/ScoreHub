import { plans, addOns, comparisonRows } from "../pricing-data";

export function PlanCards() {
  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "0.9rem",
          marginBottom: "1.5rem",
        }}
      >
        {plans.map((plan) => (
          <div
            key={plan.name}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "1.25rem 1.35rem",
              background: "var(--bg-surface)",
            }}
          >
            <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 800 }}>{plan.name}</p>
            <p className="mono" style={{ margin: "0.25rem 0 0.15rem", fontSize: "1.4rem", color: "var(--accent)" }}>
              {plan.price}
              <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>{plan.period}</span>
            </p>
            {"annual" in plan && (
              <p className="mono" style={{ margin: "0 0 0.6rem", fontSize: "0.72rem", color: "var(--text-secondary)" }}>
                {plan.annual}
              </p>
            )}
            <p style={{ margin: "annual" in plan ? 0 : "0.6rem 0 0", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              {plan.detail}
            </p>
          </div>
        ))}
      </div>

      <p className="eyebrow" style={{ margin: "0 0 0.75rem" }}>
        + Optional add-ons
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "0.9rem",
          marginBottom: "2rem",
        }}
      >
        {addOns.map((addOn) => (
          <div
            key={addOn.name}
            style={{
              border: "1px dashed var(--border-strong)",
              borderRadius: 10,
              padding: "1.1rem 1.25rem",
              background: "var(--bg-surface)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
              <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 800 }}>{addOn.name}</p>
              <p className="mono" style={{ margin: 0, fontSize: "1rem", color: "var(--accent)" }}>
                +{addOn.price}
                <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{addOn.period}</span>
              </p>
            </div>
            <p className="mono" style={{ margin: "0.1rem 0 0.5rem", fontSize: "0.7rem", color: "var(--text-secondary)" }}>
              {addOn.annual} · requires Pro or Venue
            </p>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)" }}>{addOn.detail}</p>
          </div>
        ))}
      </div>
    </>
  );
}

export function ComparisonTable() {
  // position: relative keeps the table's absolutely positioned sr-only text
  // inside this scroller instead of widening the page.
  return (
    <div style={{ position: "relative", overflowX: "auto", marginBottom: "1.75rem" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560, fontSize: "0.85rem" }}>
        <caption className="sr-only">Features by plan</caption>
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: "left", padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border-strong)", color: "var(--text-secondary)", fontWeight: 600 }}>
              Feature
            </th>
            {["Free", "Pro", "Venue"].map((col) => (
              <th
                key={col}
                scope="col"
                style={{ textAlign: "left", padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border-strong)", fontWeight: 800 }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparisonRows.map((row) => (
            <tr key={row.label}>
              <th scope="row" style={{ textAlign: "left", fontWeight: 400, padding: "0.55rem 0.75rem", borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                {row.label}
              </th>
              {[row.free, row.pro, row.venue].map((cell, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <td key={i} style={{ padding: "0.55rem 0.75rem", borderBottom: "1px solid var(--border)" }}>
                  {typeof cell === "boolean" ? (
                    <span aria-hidden="true" style={{ color: cell ? "var(--broadcast)" : "var(--text-secondary)" }}>
                      {cell ? "✓" : "—"}
                    </span>
                  ) : (
                    cell
                  )}
                  {typeof cell === "boolean" && <span className="sr-only">{cell ? "Included" : "Not included"}</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
