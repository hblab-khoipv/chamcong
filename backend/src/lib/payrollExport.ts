// T16 item 3: builds the two export formats from an already-computed
// PayrollReport (see payrollReport.ts). CSV gets only the employee summary
// (CSV has no concept of a second sheet/tab); the xlsx workbook additionally
// gets a per-session detail sheet, per the PRD's "(tuỳ chọn) chi tiết từng
// phiên ở sheet/tab phụ".
import ExcelJS from 'exceljs'
import { AttendanceSessionStatus } from '@prisma/client'
import { PayrollReport } from './payrollReport'

// Excel/Google Sheets on Windows defaults to reading a BOM-less CSV as the
// system ANSI codepage, corrupting Vietnamese diacritics -- the UTF-8 BOM
// prefix is what makes it detect UTF-8 correctly (T16 AC: "không lỗi font
// tiếng Việt").
const UTF8_BOM = '﻿'

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function buildPayrollCsv(report: PayrollReport): string {
  const header = ['Nhân viên', 'Tổng giờ', 'Tổng tiền (VND)', 'Số phiên đã tính', 'Số phiên FLAGGED']
  const lines = [header.map(csvEscape).join(',')]

  for (const row of report.rows) {
    lines.push(
      [
        csvEscape(row.employeeName),
        row.totalHours.toFixed(2),
        String(row.totalAmountVnd),
        String(row.computedSessionCount),
        String(row.flaggedSessionCount),
      ].join(',')
    )
  }

  lines.push(
    [
      csvEscape('Tổng cộng'),
      report.totalHours.toFixed(2),
      String(report.totalAmountVnd),
      String(report.computedSessionCount),
      String(report.flaggedSessionCount),
    ].join(',')
  )

  return UTF8_BOM + lines.join('\r\n')
}

export interface PayrollSessionDetailInput {
  employeeName: string
  loginTime: Date | null
  logoutTime: Date | null
  status: AttendanceSessionStatus
  hours: number
  amountVnd: number
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000

// Renders a UTC instant as a VN wall-clock "YYYY-MM-DD HH:mm" string for the
// exported sheet -- readable in Excel without the reader doing timezone math.
function formatVnDateTime(date: Date): string {
  const shifted = new Date(date.getTime() + VN_OFFSET_MS)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
}

export async function buildPayrollWorkbook(
  report: PayrollReport,
  sessionDetails: PayrollSessionDetailInput[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()

  const summary = workbook.addWorksheet('Tổng hợp')
  summary.columns = [
    { header: 'Nhân viên', key: 'employeeName', width: 28 },
    { header: 'Tổng giờ', key: 'totalHours', width: 12 },
    { header: 'Tổng tiền (VND)', key: 'totalAmountVnd', width: 18 },
    { header: 'Số phiên đã tính', key: 'computedSessionCount', width: 16 },
    { header: 'Số phiên FLAGGED', key: 'flaggedSessionCount', width: 16 },
  ]
  summary.getRow(1).font = { bold: true }
  for (const row of report.rows) {
    summary.addRow(row)
  }
  const totalsRow = summary.addRow({
    employeeName: 'Tổng cộng',
    totalHours: report.totalHours,
    totalAmountVnd: report.totalAmountVnd,
    computedSessionCount: report.computedSessionCount,
    flaggedSessionCount: report.flaggedSessionCount,
  })
  totalsRow.font = { bold: true }
  summary.getColumn('totalAmountVnd').numFmt = '#,##0'
  summary.getColumn('totalHours').numFmt = '0.00'

  const detail = workbook.addWorksheet('Chi tiết phiên')
  detail.columns = [
    { header: 'Nhân viên', key: 'employeeName', width: 28 },
    { header: 'Giờ vào', key: 'loginTime', width: 18 },
    { header: 'Giờ ra', key: 'logoutTime', width: 18 },
    { header: 'Trạng thái', key: 'status', width: 12 },
    { header: 'Số giờ', key: 'hours', width: 10 },
    { header: 'Thành tiền (VND)', key: 'amountVnd', width: 18 },
  ]
  detail.getRow(1).font = { bold: true }
  for (const row of sessionDetails) {
    detail.addRow({
      employeeName: row.employeeName,
      loginTime: row.loginTime ? formatVnDateTime(row.loginTime) : '',
      logoutTime: row.logoutTime ? formatVnDateTime(row.logoutTime) : '',
      status: row.status,
      hours: row.hours,
      amountVnd: row.amountVnd,
    })
  }
  detail.getColumn('amountVnd').numFmt = '#,##0'
  detail.getColumn('hours').numFmt = '0.00'

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
