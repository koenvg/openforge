/** Small original PDF fixtures; no third-party document content. */
export function pdfFixture({ pages = 1, width = 612, height = 792, text = true, malicious = false, tagged = false, encrypted = false } = {}): Uint8Array {
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${malicious ? '/OpenAction << /S /JavaScript /JS (fetch\\(https://pdf-action.invalid\\)) >>' : ''} ${tagged ? '/MarkInfo << /Marked true >> /StructTreeRoot 6 0 R' : ''} >>`,
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${i + 8} 0 R`).join(' ')}] /Count ${pages} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const content = text ? `${tagged ? '/P <</MCID 0>> BDC ' : ''}BT /F1 20 Tf 40 700 Td (Selectable project PDF) Tj ET${tagged ? ' EMC' : ''}` : '0.5 g 40 40 200 200 re f'
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  objects.push('<< /Type /Annot /Subtype /Link /Rect [0 0 300 300] /A << /S /URI /URI (https://pdf-action.invalid/) >> >>')
  objects.push('<< /Type /StructTreeRoot /K [7 0 R] /ParentTree << /Nums [0 [7 0 R]] >> >>')
  objects.push('<< /Type /StructElem /S /P /P 6 0 R /Pg 8 0 R /K 0 >>')
  for (let i = 0; i < pages; i++) objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R ${malicious ? '/Annots [5 0 R] /AA << /O << /S /URI /URI (https://pdf-action.invalid/open) >> >>' : ''} ${tagged ? '/StructParents 0' : ''} >>`)
  if (encrypted) objects.push(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${'11'.repeat(32)}> /U <${'22'.repeat(32)}> /P -4 >>`)
  let pdf = '%PDF-1.7\n'
  const offsets = [0]
  objects.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n` })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encrypted ? `/Encrypt ${objects.length} 0 R /ID [<${'00'.repeat(16)}> <${'00'.repeat(16)}>]` : ''} >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}
