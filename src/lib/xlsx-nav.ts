import {
  colLetter,
  dayChange,
  formatPct,
  shortName,
  sortedDates,
  type Ledger,
} from "./ledger";

function xml(s: string): string {
  return s
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;");
}

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function u16(n: number): number[] {
  return [n & 255, (n >>> 8) & 255];
}

function u32(n: number): number[] {
  return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
}

function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: number[] = [];
  const central: number[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Array.from(new TextEncoder().encode(file.name));
    const crc = crc32(file.data);
    const local = [
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(file.data.length),
      ...u32(file.data.length),
      ...u16(name.length),
      ...u16(0),
    ];
    parts.push(...local, ...name, ...file.data);
    central.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(file.data.length),
      ...u32(file.data.length),
      ...u16(name.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...name,
    );
    offset += local.length + name.length + file.data.length;
  }
  const end = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(files.length),
    ...u16(files.length),
    ...u32(central.length),
    ...u32(offset),
    ...u16(0),
  ];
  return Uint8Array.from([...parts, ...central, ...end]);
}

function inline(ref: string, value: string, style: number): string {
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t>${xml(value)}</t></is></c>`;
}

function numberCell(ref: string, value: number, style: number): string {
  return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="0.0000"/></numFmts>
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF14210A"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD6F26A"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD5DDD4"/></left>
      <right style="thin"><color rgb="FFD5DDD4"/></right>
      <top style="thin"><color rgb="FFD5DDD4"/></top>
      <bottom style="thin"><color rgb="FFD5DDD4"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
  </cellXfs>
</styleSheet>`;

function sheetXml(rows: string[], cols: string, frozen: boolean): string {
  const view = frozen
    ? `<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${view}
  ${cols}
  <sheetData>${rows.join("")}</sheetData>
</worksheet>`;
}

export function buildNavWorkbook(ledger: Ledger): Uint8Array {
  const dates = sortedDates(ledger.cells);
  const header = ["Date", ...ledger.isins.map((isin) => {
    const name = ledger.schemes[isin]?.name ?? isin;
    return `${name} (${isin})`;
  })];
  const rows: string[] = [];
  rows.push(
    `<row r="1">${header
      .map((value, i) => inline(`${colLetter(i)}1`, value, 1))
      .join("")}</row>`,
  );
  dates.forEach((date, r) => {
    const excelRow = r + 2;
    const cells = [
      inline(`A${excelRow}`, date, 0),
      ...ledger.isins.map((isin, i) => {
        const nav = ledger.cells[date]?.[isin];
        const ref = `${colLetter(i + 1)}${excelRow}`;
        return nav == null ? inline(ref, "", 0) : numberCell(ref, nav, 2);
      }),
    ];
    rows.push(`<row r="${excelRow}">${cells.join("")}</row>`);
  });
  const navSheet = sheetXml(
    rows,
    `<cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="${Math.max(2, ledger.isins.length + 1)}" width="42" customWidth="1"/></cols>`,
    true,
  );

  const dirHeader = ["ISIN", "Scheme", "Latest date", "Latest NAV", "Change vs previous row"];
  const dirRows = [
    `<row r="1">${dirHeader.map((value, i) => inline(`${colLetter(i)}1`, value, 1)).join("")}</row>`,
  ];
  ledger.isins.forEach((isin, index) => {
    const excelRow = index + 2;
    let latest = "";
    let nav: number | null = null;
    for (let i = dates.length - 1; i >= 0; i--) {
      const value = ledger.cells[dates[i]]?.[isin];
      if (value != null) {
        latest = dates[i];
        nav = value;
        break;
      }
    }
    const change = latest ? dayChange(dates, ledger.cells, latest, isin) : null;
    dirRows.push(
      `<row r="${excelRow}">${[
        inline(`A${excelRow}`, isin, 0),
        inline(`B${excelRow}`, ledger.schemes[isin]?.name ?? shortName(isin), 0),
        inline(`C${excelRow}`, latest, 0),
        nav == null ? inline(`D${excelRow}`, "", 0) : numberCell(`D${excelRow}`, nav, 2),
        inline(`E${excelRow}`, change == null ? "" : formatPct(change), 0),
      ].join("")}</row>`,
    );
  });
  const dirSheet = sheetXml(
    dirRows,
    `<cols><col min="1" max="1" width="16" customWidth="1"/><col min="2" max="2" width="54" customWidth="1"/><col min="3" max="3" width="14" customWidth="1"/><col min="4" max="5" width="24" customWidth="1"/></cols>`,
    false,
  );

  const files = [
    {
      name: "[Content_Types].xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Daily NAV" sheetId="1" r:id="rId1"/>
    <sheet name="Schemes" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { name: "xl/worksheets/sheet1.xml", text: navSheet },
    { name: "xl/worksheets/sheet2.xml", text: dirSheet },
    { name: "xl/styles.xml", text: STYLES },
  ];

  const enc = new TextEncoder();
  return zipStore(files.map((file) => ({ name: file.name, data: enc.encode(file.text) })));
}

export function downloadWorkbook(bytes: Uint8Array, filename: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
