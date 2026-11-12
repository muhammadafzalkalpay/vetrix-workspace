// CSV reader (RFC 4180 quoting, CRLF or LF, optional UTF-8 BOM). Pure.

export function parseCsv(input: string): Record<string, string>[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input; // Excel adds a BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((v) => v.trim() !== ""));
  if (!header) return [];
  const names = header.map((h) => h.trim());
  return body.map((values, n) => {
    if (values.length !== names.length) {
      throw new Error(`CSV row ${n + 2} has ${values.length} fields, expected ${names.length}`);
    }
    return Object.fromEntries(names.map((name, i) => [name, values[i]!.trim()]));
  });
}
