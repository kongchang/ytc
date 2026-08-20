// ============================================================
// ตั้งค่า Firebase สำหรับระบบติดตามคำร้องประชาชน
// ============================================================
// วิธีเอาค่ามาใส่:
// 1) ไปที่ https://console.firebase.google.com/ แล้วสร้างโปรเจกต์ใหม่ (ฟรี)
// 2) ในหน้าโปรเจกต์ กด "Build" > "Firestore Database" > "Create database"
// 3) กลับไปหน้า Project Overview กดไอคอนรูป </> (Web app) เพื่อลงทะเบียนเว็บแอป
// 4) คัดลอกค่า firebaseConfig ที่ได้มาแปะแทนค่าตัวอย่างด้านล่างทั้งหมด
//
// หมายเหตุด้านความปลอดภัย: ค่า apiKey ด้านล่างนี้ "ไม่ใช่ความลับ" — Firebase ออกแบบมาให้
// ค่านี้อยู่ในโค้ดฝั่งผู้ใช้ได้ตามปกติ ตัวที่ป้องกันข้อมูลจริง ๆ คือ "Firestore Security Rules"
// และ "Firebase Authentication" (ดูขั้นตอนตั้งค่าใน README_SECURITY.md ที่แนบมาด้วย)
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyCPvOLiK6HIrvj4MsTI0jeRpJ78gApO_k0",
  authDomain: "data-kongchang.firebaseapp.com",
  databaseURL: "https://data-kongchang-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "data-kongchang",
  storageBucket: "data-kongchang.firebasestorage.app",
  messagingSenderId: "65363064561",
  appId: "1:65363064561:web:d43ff842e508da8a075b50",
  measurementId: "G-7XG51ZHJG7"
};

firebase.initializeApp(firebaseConfig);

// ตัวแปร db ตัวนี้จะถูกเรียกใช้จาก script.js เพื่ออ่าน/เขียนข้อมูลคำร้องร่วมกันทุกคน
const db = firebase.firestore();

// ตัวแปร auth ใช้สำหรับตรวจสอบตัวตนผู้ใช้งานจริงผ่าน Firebase Authentication
// (แทนที่ระบบเช็ก username/password แบบ hardcode เดิมที่ไม่ปลอดภัย)
const auth = firebase.auth();
