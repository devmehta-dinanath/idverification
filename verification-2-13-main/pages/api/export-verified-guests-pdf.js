import { supabase } from "../../lib/supabase";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Requested-With, Accept, Accept-Version, Content-Length, Date, X-Api-Version"
  );
}

/** Format as DD/MM/YYYY (A.D.) - same as CSV export */
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

function trim(val) {
  return val != null ? String(val).trim() : "";
}

/** Build PDF with same columns as CSV: First Name, Middle Name, Last Name, Gender, Passport No., Email, Phone, End Date */
function rowsToPdfBuffer(rows) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  doc.setFontSize(16);
  doc.text("Verified Guests Report", 14, 16);
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 22);

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

  const body = rows.map((row) => [
    trim(row.first_name),
    trim(row.middle_name),
    trim(row.last_name),
    trim(row.gender),
    trim(row.passport_no),
    trim(row.email),
    trim(row.phone),
    formatDateDDMMYYYY(row.end_date),
  ]);

  autoTable(doc, {
    head: [headers],
    body,
    startY: 28,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [59, 130, 246], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    margin: { left: 14 },
    tableWidth: "auto",
  });

  return doc.output("arraybuffer");
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
      console.error("[export-verified-guests-pdf] Supabase query error:", error);
      res.status(500).json({ error: "Failed to fetch verified guests" });
      return;
    }

    const rows = data || [];
    const pdfBuffer = rowsToPdfBuffer(rows);

    const today = new Date();
    const datePart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="verified-guests-${datePart}.pdf"`);

    res.status(200).send(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error("[export-verified-guests-pdf] Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
