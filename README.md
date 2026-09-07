# เวอร์ชัน Google Sheet + Apps Script (ย้ายกลับจาก Firebase)

ไฟล์ชุดนี้ใช้ **Google Sheet เป็นฐานข้อมูล** โดยเว็บ (index.html/script.js)
คุยกับ Google Sheet ผ่าน **Google Apps Script Web App** (Code.js) ที่ deploy
เป็น API — ไม่ได้เชื่อมกับ Firebase อีกต่อไป

## ไฟล์ที่ใช้งานจริง (นำไป push ขึ้น GitHub)

- `index.html`
- `style.css`
- `script.js`
- `config.js` — ใส่ URL ของ Apps Script Web App ที่ deploy แล้ว

## ไฟล์ที่ใช้งานใน Google Apps Script (ผูกกับ Google Sheet)

- `Code.js` — วางในโปรเจกต์ Apps Script ที่ผูกกับ Google Sheet ฐานข้อมูล
  (เปิด Sheet > ส่วนขยาย > Apps Script แล้ววางโค้ดนี้ทับของเดิม)

## ขั้นตอนตั้งค่า (ทำครั้งเดียว)

### 1. เตรียม Google Sheet

ต้องมีชีตชื่อตามนี้ (ตัวพิมพ์เล็ก/ใหญ่และช่องว่างต้องตรง):

| Sheet | ใช้เก็บ | คอลัมน์ (เริ่มจาก A) |
|---|---|---|
| `Products` | สินค้า | brand, skuMerchant, gtin |
| `Orders` | ออเดอร์ | trackingNo, (เว้น), sku, qty, status, qcTime |
| `Substitute products` | สินค้าทดแทน | trackingNo, oldSku, qty, newSku, timestamp |
| `cut` | รายการตัดสินค้าออก | trackingNo, sku, qty, timestamp |
| `ลงข้อมูล` | ข้อมูลฟวย (อัปโหลดจาก Excel) | ตามไฟล์ Excel ที่อัปโหลด (คอลัมน์ A, H, I, M, N, O ตามตำแหน่งเดิม) |
| `เช็ค` | tracking ที่เช็คแล้ว (ฟวย) | เช็ค |

ชีต `สรุป` จะถูกสร้างอัตโนมัติโดยสคริปต์เมื่อมีการบันทึก QC สำเร็จครั้งแรก
ไม่ต้องสร้างเอง

### 2. Deploy Apps Script เป็น Web App

1. เปิด Google Sheet ฐานข้อมูล > เมนู **ส่วนขยาย (Extensions) > Apps Script**
2. ลบโค้ดเดิมในไฟล์ (ถ้ามี) แล้ววางเนื้อหาจาก `Code.js` ทั้งหมดแทน
3. กด **Deploy > New deployment**
   - เลือกประเภท **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. คัดลอก URL ที่ได้ (ลงท้ายด้วย `/exec`)
5. นำ URL ไปแทนที่ค่า `API_URL` ในไฟล์ `config.js`

> ทุกครั้งที่แก้โค้ดใน Apps Script แล้วต้องการให้มีผลกับ URL เดิม ให้ใช้
> **Deploy > Manage deployments > แก้ไข (แก้เวอร์ชัน) > Deploy** แทนการสร้าง
> deployment ใหม่ ไม่งั้น URL จะเปลี่ยนและต้องแก้ `config.js` ใหม่ทุกครั้ง

### 3. ตั้งค่าความปลอดภัย (ถ้าต้องการจำกัดสิทธิ์)

การ deploy แบบ "Execute as: Me, Anyone" หมายความว่าใครก็ตามที่รู้ URL
สามารถอ่าน/เขียนข้อมูลผ่าน API นี้ได้ ถ้าต้องการจำกัดเฉพาะทีม แนะนำให้
เพิ่มการตรวจสอบ token/parameter ลับใน `doGet`/`doPost` ของ `Code.js`
เอง (แจ้งได้ถ้าต้องการให้ช่วยเพิ่มส่วนนี้)

## ขั้นตอน Push ขึ้น GitHub

1. ตรวจสอบว่า `config.js` มี `API_URL` ที่ deploy สำเร็จแล้ว (ไม่ใช่ URL เดิมที่อาจหมดอายุ)
2. รันคำสั่ง:
   ```
   git add .
   git commit -m "ย้อนกลับไปใช้ Google Sheet เป็นฐานข้อมูล"
   git push
   ```
3. เปิดเว็บผ่าน GitHub Pages ตามลิงก์เดิม ทดสอบว่าข้อมูลขึ้นครบและบันทึกได้จริง

## หมายเหตุ: ไฟล์ Firebase เดิม

ไฟล์ `firebase-config.js` และการเชื่อมต่อ Firestore ไม่ได้ใช้แล้ว
ลบออกจากโฟลเดอร์ที่จะ push ได้เลย (ไม่กระทบการทำงาน เพราะ `index.html`
เอาสคริปต์ Firebase ออกไปแล้ว)
