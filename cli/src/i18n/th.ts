import type { Catalogue } from "./en";

/**
 * Thai messages.
 *
 * Commands and flags stay English — they are code, they are what the
 * documentation uses, and they type without switching IME. Only the prose
 * changes; the error code and the suggested command are identical, so one code
 * maps to one help page regardless of the language the reader saw.
 */
export const th: Catalogue = {
  SERVER_UNREACHABLE: (host: string) => ({
    code: "SERVER_UNREACHABLE",
    title: `เชื่อมต่อ ${host} ไม่ได้`,
    body: "ดูเหมือนว่าเว็บแอปยังไม่ได้เปิดใช้งาน",
    fix: "docker compose up -d",
  }),
  NOT_AUTHENTICATED: (host: string) => ({
    code: "NOT_AUTHENTICATED",
    title: `ยังไม่ได้เข้าสู่ระบบ ${host}`,
    body: "เซิร์ฟเวอร์นี้ต้องใช้ access token",
    fix: "kmutt login",
  }),
  KB_NOT_CONNECTED: () => ({
    code: "KB_NOT_CONNECTED",
    title: "ยังไม่ได้เชื่อมต่อฐานความรู้",
    body: "การค้นหาและการถามต้องใช้ Pinecone index",
    fix: "kmutt doctor",
  }),
  NO_MATCH: (n: number) => ({
    code: "NO_MATCH",
    title: "ไม่พบข้อมูลที่ตรงกันในฐานความรู้",
    body: `ค้นหาจาก ${n} เอกสารแล้ว ลองเปลี่ยนคำค้น`,
    fix: "",
  }),
  DOC_NOT_FOUND: (id: string) => ({
    code: "DOC_NOT_FOUND",
    title: `ไม่พบเอกสารรหัส ${id}`,
    body: "รหัสคือตัวอักษรย่อในคอลัมน์แรก",
    fix: "kmutt ls",
  }),
  LOCAL_FILE_NOT_FOUND: (p: string) => ({
    code: "LOCAL_FILE_NOT_FOUND",
    title: `ไม่พบไฟล์ที่ ${p}`,
    body: "ตรวจสอบจากโฟลเดอร์ที่รันคำสั่งนี้",
    fix: "",
  }),
  FILE_NOT_FOUND: (p: string) => ({
    code: "FILE_NOT_FOUND",
    title: `ไม่พบไฟล์ที่ ${p}`,
    body: "พาธอ้างอิงจากโฟลเดอร์ทำงาน",
    fix: "kmutt ls",
  }),
  TITLE_REQUIRED: () => ({
    code: "TITLE_REQUIRED",
    title: "เอกสารทุกฉบับต้องมีชื่อเรื่อง เพราะเป็นสิ่งที่แสดงในการอ้างอิง",
    body: "",
    fix: 'kmutt add rules.pdf --title "ระเบียบการศึกษา 2566"',
  }),
  SCANNED_PDF: (id: string) => ({
    code: "SCANNED_PDF",
    title: "ไฟล์ PDF นี้เป็นภาพสแกน จึงไม่มีข้อความให้จัดทำดัชนี",
    body: "หน้าเอกสารเป็นรูปภาพ และระบบยังไม่มีขั้นตอน OCR",
    fix: `ทำ OCR ก่อน แล้วสั่ง: kmutt reindex ${id}`,
  }),
};
