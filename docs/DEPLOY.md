# Onlayn chiqarish — 20 daqiqa

Panel hozir faqat `localhost` da ishlaydi, chunki u kompyuteringizdagi
PostgreSQL ga ulangan. Onlayn ko'rish uchun uchta narsa kerak: kod GitHub'da,
baza bulutda, ilova Vercel'da.

Hammasi bepul tarifda ishlaydi.

---

## 1-qadam — GitHub (5 daqiqa)

Repozitoriy yaratish uchun akkauntingiz kerak, shuning uchun buni o'zingiz
qilasiz.

1. https://github.com/new — repo nomi: `sinolife-dashboard`
2. **Private** tanlang (ichki tizim, ochiq bo'lmasligi kerak)
3. README/gitignore qo'shmang — bizda allaqachon bor
4. **Create repository**

Keyin terminalda, `G:\ISH` ichida:

```bash
git remote add origin https://github.com/SIZNING_NOMINGIZ/sinolife-dashboard.git
git branch -M main
git push -u origin main
```

Parol so'rasa — GitHub parolingiz emas, **Personal Access Token** kerak:
https://github.com/settings/tokens → *Generate new token (classic)* → `repo`
ruxsati → nusxalang va parol o'rniga qo'ying.

> `.env` push qilinmaydi — `.gitignore` da. Bitrix24 tokeningiz GitHub'ga
> tushmaydi.

---

## 2-qadam — Bulutdagi PostgreSQL (5 daqiqa)

Kompyuteringizdagi baza internetdan ko'rinmaydi. Bepul variant:

1. https://neon.tech → GitHub bilan kiring
2. **Create project** → nomi `sinolife`, region **Frankfurt** (O'zbekistonga eng yaqini)
3. Connection string'ni nusxalang:
   ```
   postgresql://user:parol@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```

Sxemani va demo ma'lumotni o'sha bazaga ko'chiring — terminalda:

```bash
# Vaqtincha bulut bazasiga ulanamiz
$env:DATABASE_URL="NEON_DAN_NUSXALAGAN_MANZIL"
npx prisma migrate deploy
npm run db:seed
npm run db:seed:users
```

---

## 3-qadam — Vercel (10 daqiqa)

1. https://vercel.com → GitHub bilan kiring
2. **Add New → Project** → `sinolife-dashboard` repozitoriyni tanlang
3. **Environment Variables** bo'limiga quyidagilarni kiriting:

| Nomi | Qiymati |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `DATA_SOURCE` | `demo` |
| `DEMO_SEED` | `20260101` |
| `BETTER_AUTH_SECRET` | yangi tasodifiy satr (pastga qarang) |
| `BETTER_AUTH_URL` | `https://sizning-loyihangiz.vercel.app` |
| `NEXT_PUBLIC_APP_URL` | xuddi shu manzil |
| `APP_TIMEZONE` | `Asia/Tashkent` |
| `APP_DEFAULT_LOCALE` | `uz` |
| `APP_DEFAULT_CURRENCY` | `UZS` |
| `LOG_LEVEL` | `info` |

Yangi secret yaratish:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

4. **Deploy**

Tayyor. Manzil: `https://sizning-loyihangiz.vercel.app`

> `BETTER_AUTH_URL` `https://` bilan boshlangani uchun cookie'lar avtomatik
> `Secure` bo'ladi — alohida sozlash shart emas.

---

## Deploy qilishdan oldin — MUHIM

**Demo parollarni almashtiring.** Hozir `admin@sinolife.uz` / `demo1234`
internetda ochiq bo'ladi.

`prisma/seedUsers.ts` dagi parollarni o'zgartiring, keyin:

```bash
npm run db:seed:users
```

**Bitrix24 tokenini yangilang.** Hozirgisi yozishmaga tushgan. Bitrix24 →
webhook → o'chirib, yangisini yarating.

---

## Bitrix24 ma'lumotini onlayn ko'rsatish

Yuqoridagi qadamlar **demo** ma'lumot bilan ishlaydi — bu to'g'ri boshlanish,
chunki demo ma'lumotda maxfiy narsa yo'q.

Haqiqiy Bitrix24 ma'lumotini onlayn qo'yish alohida qaror: u real mijoz
ismlari, telefon raqamlari va savdo raqamlarini bulutga chiqaradi. Buni
xohlasangiz:

1. Vercel'da `BITRIX24_WEBHOOK_URL` ni qo'shing
2. `DATA_SOURCE` ni `bitrix24` ga o'zgartiring
3. Importni ishga tushiring

Lekin avval sinov importi natijalarini tekshirib, raqamlar Bitrix24 hisobotlari
bilan mos kelishiga ishonch hosil qiling.
