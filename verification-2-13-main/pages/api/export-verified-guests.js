import { supabase } from "../../lib/supabase";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Requested-With, Accept, Accept-Version, Content-Length, Date, X-Api-Version"
  );
}

/** Format as DD/MM/YYYY (A.D.) for TM30 / sheet compatibility */
function formatDateDDMMYYYY(value) {
  if (!value) return "";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return String(value);
  }
}

/** Always quote so empty fields (e.g. middle name) don't shift columns in Excel/Sheets */
function toCsvValue(value) {
  if (value === null || value === undefined) return '""';
  const str = String(value).trim();
  return `"${str.replace(/"/g, '""')}"`;
}

function rowsToCsv(rows) {
  const headers = [
    "First Name",
    "Middle Name",
    "Last Name",
    "Gender",
    "Passport No.",
    "Email",
    "Phone",
    "End Date",
  ];

  const headerLine = headers.map(toCsvValue).join(",");

  const lines = rows.map((row) => {
    return [
      row.first_name,
      row.middle_name,
      row.last_name,
      row.gender,
      row.passport_no,
      row.email,
      row.phone,
      formatDateDDMMYYYY(row.end_date),
    ].map(toCsvValue).join(",");
  });

  return [headerLine, ...lines].join("\n");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { from, to, limit = "10000" } = req.query || {};
    const rowLimit = Number.parseInt(Array.isArray(limit) ? limit[0] : limit, 10);
    const safeLimit = Number.isNaN(rowLimit) || rowLimit <= 0 ? 10000 : Math.min(rowLimit, 50000);

    let query = supabase
      .from("verified_guest_rows")
      .select("*")
      .order("verified_at", { ascending: false })
      .limit(safeLimit);

    if (from) {
      query = query.gte("verified_at", from);
    }
    if (to) {
      query = query.lte("verified_at", to);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[export-verified-guests] Supabase query error:", error);
      res.status(500).json({ error: "Failed to fetch verified guests" });
      return;
    }

    const rows = data || [];
    const csv = rowsToCsv(rows);

    const today = new Date();
    const datePart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="verified-guests-${datePart}.csv"`);

    res.status(200).send(csv);
  } catch (err) {
    console.error("[export-verified-guests] Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

