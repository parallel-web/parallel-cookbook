/**
 * Simple CSV parser handling quoted fields, embedded commas, escaped quotes, and BOM.
 * Returns array of row arrays (including header row).
 */
export function parseCSV(content: string): string[][] {
  // Strip BOM
  const cleaned = content.replace(/^\uFEFF/, "");

  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < cleaned.length) {
    const ch = cleaned[i];

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote ""
        if (i + 1 < cleaned.length && cleaned[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        current.push(field);
        field = "";
        i++;
      } else if (ch === "\r") {
        // Handle \r\n and bare \r
        current.push(field);
        field = "";
        rows.push(current);
        current = [];
        i++;
        if (i < cleaned.length && cleaned[i] === "\n") {
          i++;
        }
      } else if (ch === "\n") {
        current.push(field);
        field = "";
        rows.push(current);
        current = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Push last field/row
  if (field.length > 0 || current.length > 0) {
    current.push(field);
    rows.push(current);
  }

  return rows;
}
