# ระบบติดตามแฟ้มเอกสาร — ตั้งค่า Firebase

ไฟล์ในโฟลเดอร์นี้:
- `index.html` — โครงหน้าเว็บ
- `styles.css` — สไตล์ทั้งหมด
- `script.js` — โค้ดการทำงานของแอป (เชื่อมกับ Firestore)
- `firebase-config.js` — ค่าคอนฟิกของโปรเจกต์ Firebase คุณ (ต้องแก้ไขก่อนใช้งาน)

## ขั้นตอนตั้งค่า

1. **สร้างโปรเจกต์ Firebase**
   ไปที่ https://console.firebase.google.com → Add project → ตั้งชื่อโปรเจกต์

2. **เปิดใช้งาน Firestore Database**
   เมนูซ้าย → Build → Firestore Database → Create database
   (เลือกโหมด "Start in test mode" ไปก่อนเพื่อทดสอบ แล้วค่อยตั้ง Rules ให้รัดกุมภายหลัง — ดูหัวข้อด้านล่าง)

3. **สร้างเว็บแอปเพื่อรับค่า config**
   Project settings (ไอคอนเฟือง) → General → เลื่อนลงไปที่ "Your apps" → กด `</>` → ตั้งชื่อแอป → จะได้อ็อบเจกต์ `firebaseConfig`

4. **วางค่าใน `firebase-config.js`**
   แทนที่ `YOUR_API_KEY`, `YOUR_PROJECT_ID` ฯลฯ ด้วยค่าจริงที่ได้จากขั้นตอนที่ 3

5. **รันเว็บผ่านเซิร์ฟเวอร์ (ห้ามเปิดไฟล์ตรง ๆ)**
   เพราะ `script.js` เป็น ES module (`import`/`export`) เบราว์เซอร์ (โดยเฉพาะ Chrome) จะบล็อกถ้าเปิดแบบ `file://` ตรง ๆ
   ใช้วิธีใดวิธีหนึ่ง:
   - `npx serve .` (ถ้ามี Node.js)
   - `python3 -m http.server` แล้วเปิด `http://localhost:8000`
   - หรือ deploy ขึ้น Firebase Hosting / Netlify / Vercel ก็ได้เลย

## ตั้งค่า Firestore Security Rules

โหมดทดสอบ (test mode) จะหมดอายุใน 30 วันและเปิดให้ใครก็เขียนอ่านได้ทุกคน ถ้าจะใช้งานจริงแนะนำตั้ง Rules อย่างน้อยแบบนี้ (Firestore → Rules):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /entries/{entryId} {
      allow read, write: if true;
    }
  }
}
```

⚠️ **ข้อควรระวัง**: กฎด้านบน (`allow read, write: if true`) หมายความว่าใครก็ตามที่มีค่า config ของคุณ (ซึ่งฝังอยู่ใน `firebase-config.js` ที่เป็น public) สามารถอ่าน/แก้ไข/ลบข้อมูลได้ทั้งหมด เหมาะสำหรับใช้คนเดียวหรือทดสอบเท่านั้น ถ้าต้องการความปลอดภัยกว่านี้ (เช่น มีหลายคนใช้ หรือเผยแพร่สาธารณะ) ควรเพิ่ม Firebase Authentication แล้วเปลี่ยนกฎเป็นตรวจสอบผู้ใช้ที่ล็อกอิน เช่น `allow read, write: if request.auth != null;`

## หมายเหตุเรื่องรูปภาพ

รูปที่แนบจะถูกลดขนาดและเก็บเป็น base64 อยู่ในเอกสาร Firestore โดยตรง (ไม่ได้ใช้ Firebase Storage) ซึ่งใช้งานได้ดีในระดับปกติ แต่ Firestore จำกัดขนาดเอกสารที่ 1MB ต่อรายการ — ระบบลดขนาดรูปให้อัตโนมัติอยู่แล้วจึงไม่น่ามีปัญหา แต่ถ้ามีแฟ้มจำนวนมากและใช้งานหนักในระยะยาว อาจพิจารณาย้ายไปใช้ Firebase Storage แทนในอนาคต
