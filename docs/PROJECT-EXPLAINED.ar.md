<div dir="rtl">

# كاشير (Cachier POS) — شرح المشروع كله من الصفر

> English version: [PROJECT-EXPLAINED.en.md](PROJECT-EXPLAINED.en.md)

هذا الدليل يفترض أنك **لا تعرف أي شيء**. اقرأه مرة واحدة من البداية للنهاية، ثم استخدمه كمرجع. المصطلحات التقنية مكتوبة بالإنجليزية بين قوسين لأنها هي التي ستراها في الكود، وكلها مشروحة في القاموس (القسم 3).

المحتويات:

1. ما هو هذا المشروع
2. الصورة الكبيرة
3. القاموس — كل كلمة تحتاجها
4. جولة في المجلدات
5. رحلة عملية بيع واحدة خطوة بخطوة
6. قواعد العمل (الفلوس، الضريبة، الوزن، الصلاحيات)
7. باقي المميزات
8. تطبيق الكمبيوتر وتطبيق أندرويد
9. تشغيل المشروع على جهازك
10. رفعه على الإنترنت وبناء التطبيقات
11. التشغيل اليومي وحل المشاكل
12. جدول مقارنة React ↔ Vue
13. ماذا تقرأ بعد ذلك

---

## 1. ما هو هذا المشروع

**نقطة البيع (POS — Point of Sale)** هي البرنامج الذي يستخدمه الكاشير على الكاونتر. في السوبر ماركت يجب أن:

- يجد المنتج عندما يمسح الكاشير الباركود (**Scan**)؛
- يضيفه لسلة العميل (**Cart**) بالسعر والضريبة الصحيحين؛
- يستلم الدفع (كاش أو كارت) ويحسب الباقي؛
- يطبع **الإيصال (Receipt)**؛
- يخصم الكمية المباعة من **المخزون (Stock)**؛
- يحتفظ بسجل لا يمكن تعديله سرًّا، حتى يثق صاحب المحل في الأرقام.

**كاشير** هو هذا البرنامج لسوبر ماركت حقيقي في مصر. ويقوم أيضًا بأشياء أكثر: الورديات (**Shifts**) وعدّ درج النقدية، المرتجعات، الجرد، الموردين وأوامر الشراء، العملاء والعروض، التقارير، تنبيهات نقص المخزون، البيع بدون إنترنت عند انقطاعه، ومساعد ذكاء اصطناعي يجيب عن أسئلة حول بيانات المحل.

البرنامج **بالعربي والإنجليزي**. العربية تُكتب من اليمين لليسار (**RTL**)، فكل شاشة تنقلب اتجاهها عند تغيير اللغة.

---

## 2. الصورة الكبيرة

كاشير هو **موقع ويب واحد**. كل شيء آخر (تطبيق الكمبيوتر، تطبيق أندرويد) هو "نافذة" تفتح هذا الموقع.

</div>

```
  Cashier at the counter            Manager on the phone           Anyone with a browser
  ┌───────────────────────┐        ┌───────────────────────┐       ┌──────────────────┐
  │ Desktop app (Electron)│        │ Android app (Capacitor)│       │ Chrome / Edge    │
  └──────────┬────────────┘        └───────────┬───────────┘       └────────┬─────────┘
             └──────────────── all open the same website ──────────────────┘
                                         │  internet (HTTPS)
                                         ▼
              ┌──────────────────────────────────────────────────────┐
              │  THE WEBSITE  — Next.js, hosted on Vercel            │
              │  • pages the user sees (register, products, reports) │
              │  • "server actions": code that runs on the server     │
              └───────────────────────────┬──────────────────────────┘
                                          ▼
              ┌──────────────────────────────────────────────────────┐
              │  THE DATABASE — Supabase (PostgreSQL)                │
              │  • tables: products, sales, shifts, …                │
              │  • login accounts (Auth)                             │
              │  • security rules (RLS) and checkout function (RPC)  │
              └──────────────────────────────────────────────────────┘
```

<div dir="rtl">

تخيّلها مثل مطعم:

- **المتصفح / التطبيق** هو صالة المطعم حيث يجلس الزبائن (الكاشيرية)؛
- **سيرفر الموقع (Next.js على Vercel)** هو الجرسون الذي يأخذ الطلبات ويحضر الأكل؛
- **قاعدة البيانات (Supabase)** هي المطبخ والمخزن، وفيها شيف صارم (قواعد الأمان) يرفض أي طلب مخالف للقواعد — حتى لو أخطأ الجرسون.

هذه النقطة الأخيرة هي أهم فكرة في تصميم المشروع: **قاعدة البيانات نفسها تفرض القواعد**، فلا يمكن لخطأ في الموقع أو لكاشير يحاول التحايل أن يُفسد سجلات الفلوس.

---

## 3. القاموس — كل كلمة تحتاجها

| الكلمة                                               | المعنى ببساطة                                                                                                                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Server (السيرفر)**                                 | كمبيوتر على الإنترنت يشغّل الكود لكل المستخدمين. سيرفرنا على Vercel.                                                                                                       |
| **Client / Browser (المتصفح)**                       | البرنامج على جهاز المستخدم الذي يعرض الصفحات (Chrome أو Edge أو تطبيقاتنا).                                                                                                |
| **Database (قاعدة البيانات)**                        | مخزن منظم ودائم للبيانات. عندنا PostgreSQL ("Postgres").                                                                                                                   |
| **Table (جدول)**                                     | مثل ورقة Excel: صفوف (منتج في كل صف) وأعمدة (الاسم، السعر…).                                                                                                               |
| **Migration (ملف تهجير)**                            | ملف SQL يغيّر هيكل قاعدة البيانات (يضيف جدولًا أو عمودًا أو قاعدة). موجودة في `supabase/migrations/` وتعمل بترتيب التاريخ. لا تعدّل ملفًا قديمًا أبدًا — أضف ملفًا جديدًا. |
| **SQL**                                              | اللغة التي نكلّم بها قاعدة البيانات (`select`, `insert`, `update`).                                                                                                        |
| **Supabase**                                         | خدمة جاهزة تعطينا Postgres + تسجيل دخول المستخدمين + قواعد الأمان + واجهة API تلقائية.                                                                                     |
| **API**                                              | طريقة يطلب بها برنامج بيانات من برنامج آخر. Supabase يعمل API لكل جدول تلقائيًا.                                                                                           |
| **RLS (أمان على مستوى الصف)**                        | قواعد داخل Postgres تحدد لكل صف من يستطيع قراءته أو تعديله. مثال: "الكاشير يرى وردياته فقط".                                                                               |
| **RPC / Database function (دالة في قاعدة البيانات)** | دالة مخزنة داخل Postgres تنفذ مهمة كاملة مرة واحدة. `create_sale` هي دالة إتمام البيع.                                                                                     |
| **Transaction (معاملة)**                             | مجموعة تغييرات إما أن تحدث **كلها** أو **لا شيء منها**. البيعة الواحدة معاملة واحدة: لا توجد نصف بيعة.                                                                     |
| **Next.js**                                          | إطار العمل المبني به الموقع. يصنع الصفحات ويشغّل كود السيرفر.                                                                                                              |
| **React**                                            | المكتبة التي ترسم الشاشات من قطع صغيرة اسمها **Components**.                                                                                                               |
| **Component (مكوّن)**                                | قطعة شاشة قابلة لإعادة الاستخدام: زر، السلة، شاشة الكاشير كلها. ملفاتها في `components/`.                                                                                  |
| **TypeScript**                                       | JavaScript مع أنواع — المحرر يحذّرك لو أرسلت نصًّا مكان رقم.                                                                                                               |
| **Server Component**                                 | مكوّن يعمل على السيرفر ويرسل HTML جاهزًا. هو الافتراضي في Next.js.                                                                                                         |
| **Client Component**                                 | مكوّن يعمل في المتصفح لأنه يحتاج ضغطات وكتابة. يبدأ بـ `"use client"`.                                                                                                     |
| **Server action**                                    | دالة في `lib/actions/` تعمل على السيرفر لكن تُستدعى من زر كأنها دالة عادية. كل عمليات الحفظ تمر من هنا.                                                                    |
| **Zod**                                              | مكتبة تتأكد أن البيانات بالشكل الصحيح ("السعر رقم صحيح ≥ 0") قبل استخدامها.                                                                                                |
| **Zustand**                                          | مكتبة صغيرة لحفظ حالة مشتركة في المتصفح — نستخدمها للسلة.                                                                                                                  |
| **TanStack Query**                                   | مكتبة تجلب البيانات من السيرفر وتحتفظ بنسخة مؤقتة منها.                                                                                                                    |
| **next-intl**                                        | مكتبة الترجمة. النصوص في `messages/ar.json` و `messages/en.json`.                                                                                                          |
| **Tailwind / shadcn/ui**                             | أدوات التصميم: Tailwind يعطي أسماء CSS قصيرة، و shadcn/ui يعطي مكونات جاهزة (نوافذ، جداول) في `components/ui/`.                                                            |
| **PWA**                                              | موقع يمكن "تثبيته" ويعمل كتطبيق.                                                                                                                                           |
| **Service worker**                                   | سكربت صغير يتركه المتصفح يعمل في الخلفية، يحفظ الصفحات ليفتح الموقع بدون إنترنت (`app/sw.ts`).                                                                             |
| **IndexedDB**                                        | قاعدة بيانات داخل المتصفح. نحفظ فيها مبيعات الأوفلاين ونسخة من قائمة المنتجات (`lib/offline/`).                                                                            |
| **Outbox (صندوق الصادر)**                            | طابور المبيعات التي تمت بدون إنترنت وتنتظر الإرسال.                                                                                                                        |
| **Idempotency key (مفتاح عدم التكرار)**              | رقم فريد لكل بيعة، فلو أُرسلت نفس البيعة مرتين تُسجَّل مرة واحدة فقط.                                                                                                      |
| **Electron**                                         | أداة لعمل برنامج كمبيوتر (Windows/Mac/Linux) من موقع ويب. المجلد `desktop/`.                                                                                               |
| **Capacitor**                                        | أداة لعمل تطبيق أندرويد/آيفون من موقع ويب. المجلد `mobile/`.                                                                                                               |
| **Environment variable (متغير بيئة)**                | إعداد يُعطى للبرنامج من الخارج (كلمات سر، عناوين)، ولا يُكتب في الكود أبدًا. انظر `.env.example`.                                                                          |
| **Service role key**                                 | "المفتاح الرئيسي" لـ Supabase الذي يتخطى RLS. السيرفر فقط يملكه. ممنوع في المتصفح وممنوع في git.                                                                           |
| **CI**                                               | GitHub يشغّل كل الفحوصات والاختبارات تلقائيًا مع كل تغيير (`.github/workflows/ci.yml`).                                                                                    |
| **Deploy (النشر)**                                   | وضع نسخة جديدة على الإنترنت (Vercel يفعلها مع كل دمج في `main`).                                                                                                           |
| **ESC/POS**                                          | لغة أوامر طابعات الإيصالات (`lib/receipts/escpos.ts`).                                                                                                                     |
| **WebUSB**                                           | ميزة في المتصفح تسمح للصفحة بالتحدث مع جهاز USB (الطابعة). Chrome و Edge فقط.                                                                                              |
| **Piaster (قرش)**                                    | 1/100 من الجنيه. كل الفلوس تُخزن كقروش بأرقام صحيحة.                                                                                                                       |

---

## 4. جولة في المجلدات

</div>

```
cashier-1/
├── app/                    the pages (each folder = a web address)
│   ├── [locale]/           "ar" or "en" — the language is part of the address: /ar/register
│   │   ├── (auth)/login/   the login page
│   │   └── (app)/          every page behind the side menu
│   │       ├── register/   the till screen
│   │       ├── products/   product list, new, edit, CSV import
│   │       ├── shifts/     open/close shifts, Z-report
│   │       ├── receipts/   past receipts, returns
│   │       ├── reports/    sales, VAT, stock, reorder
│   │       └── …           customers, suppliers, purchase-orders, stocktakes, users, devices, audit
│   ├── api/                endpoints called by machines (health check, cron, payment webhook, AI)
│   ├── manifest.ts         PWA install info (name, icons)
│   └── sw.ts               service worker (offline cache)
├── components/             screen pieces, grouped by feature (register/, products/, ui/ …)
├── hooks/                  reusable browser logic: barcode scanner, online status, printer
├── lib/                    the "brain" (no screens here)
│   ├── actions/            server actions — every change to data goes through here
│   ├── supabase/           database clients + queries/ (all reads) + generated types
│   ├── validation/         Zod schemas (rules for every form)
│   ├── money.ts            piaster maths and formatting
│   ├── store/cart.ts       the cart (Zustand)
│   ├── offline/            outbox, offline catalog, sync
│   ├── receipts/           building receipts, PDF, ESC/POS, Z-report
│   ├── devices/            printer transport and print jobs
│   ├── barcode/            scanner-burst detection, camera decoding
│   ├── payments/           payment providers and webhook checking
│   ├── ai/                 the assistant and its read-only tools
│   └── ops/, observability/ alerts, logging, health
├── messages/               ar.json and en.json — every text on screen
├── i18n/                   language settings for next-intl
├── supabase/migrations/    the database, built step by step in SQL
├── scripts/                seed data, backups, and the 36 test suites (test-*.ts)
├── desktop/                the Electron desktop app
├── mobile/                 the Capacitor Android/iOS app
├── docs/                   documentation (you are here)
├── prompts/                the phase-by-phase instructions used to build the project
├── proxy.ts                runs before every page: language + "are you logged in?"
├── next.config.ts          Next.js settings and security headers
└── .github/workflows/      CI (tests on every change) and app builds
```

<div dir="rtl">

القاعدة البسيطة: **الشاشات في `components/` و `app/`، والمنطق في `lib/`، وقواعد البيانات في `supabase/migrations/`.** المكونات لا تكلّم قاعدة البيانات مباشرة أبدًا؛ بل تستدعي `lib/actions/` (للتعديل) أو `lib/supabase/queries/` (للقراءة).

---

## 5. رحلة عملية بيع واحدة خطوة بخطوة

لنتابع عميلًا يشتري زجاجتين مياه و 1.25 كيلو طماطم، ويدفع 100 جنيه كاش.

1. **الوردية مفتوحة.** قبل البيع يفتح الكاشير وردية ويكتب المبلغ الموجود في الدرج في البداية (**Opening float**). بدون وردية مفتوحة تكون شاشة البيع مقفولة (`components/register/open-shift-gate.tsx`).
2. **المسح.** قارئ الباركود USB يتصرف مثل كيبورد سريع جدًّا: "يكتب" الباركود في أجزاء من الثانية ثم يضغط Enter. الملف `hooks/use-barcode-scanner.ts` يستمع لكل الأزرار في الصفحة، و `lib/barcode/scan-detector.ts` يقرر: أزرار بينها أقل من 50 ملي ثانية وتنتهي بـ Enter = مسح؛ أبطأ من ذلك = إنسان يكتب.
3. **البحث عن المنتج.** `components/register/register.tsx` يسأل السيرفر عن المنتج صاحب هذا الباركود (أو النسخة المحفوظة في IndexedDB لو لا يوجد إنترنت).
4. **الإضافة للسلة.** يُضاف المنتج للسلة في `lib/store/cart.ts`. المسح مرة أخرى يزيد الكمية 1. للطماطم (الوحدة = كيلو) يكتب الكاشير `1.25` في الكمية.
5. **الإجماليات.** السلة تحسب كل سطر بالقروش عن طريق `lib/money.ts`: السعر × الكمية، ناقص الخصومات، وكم منها ضريبة. العروض يحسبها السيرفر حتى تتطابق المعاينة مع البيعة الحقيقية.
6. **الدفع.** يضغط الكاشير **F2**. نافذة `components/register/checkout-dialog.tsx` تسأل عن طريقة الدفع والمبلغ المدفوع (10000 قرش = 100 جنيه) وتعرض الباقي.
7. **Server action.** التأكيد يستدعي `createSale` في `lib/actions/sales.ts`. يفحص البيانات بـ Zod (`lib/validation/sale.ts`) ثم يستدعي دالة قاعدة البيانات.
8. **قاعدة البيانات تنفذ كل شيء مرة واحدة** في `create_sale` (معاملة واحدة):
   - تقفل صفوف المنتجات حتى لا يبيع كاشيران آخر زجاجة مرتين؛
   - تعيد قراءة الأسعار الحقيقية من قاعدة البيانات (لا تثق في أسعار المتصفح)؛
   - تتأكد أن المخزون يكفي؛
   - تضيف البيعة برقم البيعة التالي، وصفًّا في `sale_items` لكل سطر فيه **نسخة ثابتة (Snapshot)** من الاسم والسعر والضريبة؛
   - تخصم المخزون وتكتب صفًّا في `stock_movements` لكل منتج؛
   - تسجّل الكاش في دفتر الدرج وسجل الدفع.
     لو فشل أي جزء، **لا يُحفظ أي شيء**.
9. **الإيصال.** يعرض المتصفح الإيصال (`components/receipts/receipt-80mm.tsx`) ويطبعه — على الطابعة الحرارية بأوامر ESC/POS، أو عن طريق نافذة الطباعة العادية / PDF.
10. **نهاية اليوم.** عند قفل الوردية يعدّ الكاشير الدرج. النظام يعرف كم **يجب** أن يكون فيه (الافتتاحي + مبيعات الكاش − مرتجعات الكاش ± الإيداع والسحب). الفرق الكبير يحتاج رقم PIN المدير. **تقرير Z (Z-report)** يلخّص الوردية.

---

## 6. قواعد العمل

**الفلوس بالقروش.** 48.95 جنيه تُخزن كرقم صحيح `4895`. الكمبيوتر يخطئ أخطاء صغيرة مع الأرقام العشرية (0.1 + 0.2 = 0.30000000000000004)، وهذا كان سيجعل الدرج يختلف بالقروش. الأرقام الصحيحة لا تخطئ. التحويل يتم فقط في `lib/money.ts`.

**ضريبة القيمة المضافة (VAT).** الضريبة العادية في مصر 14%. كل منتج له `tax_rate` خاص به (0.14، أو 0 للسلع الأساسية المعفاة). أسعار الرف **شاملة** الضريبة؛ والنظام يحسب كم منها ضريبة للإيصال ولتقرير الضريبة.

**بالقطعة وبالكيلو.** الحقل `unit` قيمته `piece` أو `kg`. منتجات الكيلو تقبل حتى 3 أرقام عشرية (1.250 كيلو).

**النسخ الثابتة (Snapshots).** كل سطر مباع ينسخ اسم المنتج وسعره وضريبته في تلك اللحظة. لو غيّرت سعر المياه غدًا، يظل إيصال الأمس يعرض سعر الأمس. الإيصالات **لا يمكن** تعديلها أو حذفها أبدًا — الأخطاء تُصحَّح بـ **مرتجع (Return)**.

**الصلاحيات (Roles).**

- **admin (المدير)** — كل شيء.
- **cashier (الكاشير)** — شاشة البيع ووردياته فقط.
- **Capabilities (صلاحيات إضافية)** — يمنحها المدير لموظف معين (مثل الموافقة على الخصومات أو تصحيح المخزون).
- **Manager approval (موافقة المدير)** — بعض العمليات (خصم كبير، مرتجع كبير، فرق كاش) تحتاج أن يكتب المدير رقم PIN الخاص به على شاشة الكاشير. الموافقة تُستخدم مرة واحدة فقط وتُسجَّل.

هذه القواعد تفرضها **سياسات RLS ودوال قاعدة البيانات**، وليس مجرد إخفاء الأزرار.

---

## 7. باقي المميزات

| الميزة                 | ماذا تفعل                                                                              | أين                                                    |
| ---------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| الورديات ودرج النقدية  | الرصيد الافتتاحي، إيداع/سحب، تحويل للخزنة، العدّ عند القفل، موافقة الفرق، تقرير Z      | `app/[locale]/(app)/shifts/`, `components/shifts/`     |
| المرتجعات والاستبدال   | المرتجع مستند مستقل مرتبط بالبيعة الأصلية؛ تختار إرجاعه للمخزون أو لا؛ طريقة رد المبلغ | `components/receipts/return-dialog.tsx`                |
| المنتجات والمخزون      | إضافة/تعديل منتجات، استيراد CSV، تعديل المخزون بسبب، سجل الحركات                       | `components/products/`                                 |
| الجرد                  | عدّ الأرفف ومقارنتها بالنظام، والمدير يوافق على التسويات                               | `components/stocktakes/`                               |
| الموردون وأوامر الشراء | الطلب من الموردين، استلام البضاعة (المخزون يزيد والتكلفة تُسجَّل)                      | `components/purchasing/`                               |
| العملاء والعروض        | عميل اختياري برقم الموبايل، عروض بقواعد وأكواد                                         | `components/customers/`, `components/promotions/`      |
| المدفوعات              | سجلات الكاش والكارت، الدفع المقسّم، شاشة المطابقة                                      | `app/[locale]/(app)/payments/`, `lib/payments/`        |
| البيع بدون إنترنت      | عند انقطاع الإنترنت تُحفظ مبيعات الكاش في المتصفح وتُرسل لاحقًا، مرة واحدة، بالترتيب   | `lib/offline/`, `components/offline/`                  |
| الطباعة والأجهزة       | طابعة حرارية عبر WebUSB، فتح درج النقدية، سجل الأجهزة                                  | `lib/devices/`, `app/[locale]/(app)/devices/`          |
| التقارير               | ملخص يومي، مبيعات، ضريبة، قيمة المخزون، اقتراحات إعادة الطلب، يوم العمل بتوقيت القاهرة | `app/[locale]/(app)/reports/`                          |
| سجل المراجعة (Audit)   | من فعل أي عملية حساسة ومتى                                                             | `app/[locale]/(app)/audit/`                            |
| المساعد الذكي          | يجيب عن أسئلة حول بيانات المحل؛ قراءة فقط، وبحد للطلبات                                | `components/chat-widget.tsx`, `lib/ai/`                |
| التشغيل                | فحص صحة الموقع، تنبيهات كل 15 دقيقة، نسخ احتياطي                                       | `app/api/`, `scripts/backup-db.sh`, `docs/operations/` |

---

## 8. تطبيق الكمبيوتر وتطبيق أندرويد

التطبيقان **غلاف رفيع (Thin shell)**: إطار يفتح الموقع الحقيقي. لهذا هما صغيران، ولهذا **أي تحديث للموقع يصل لكل الأجهزة فورًا** — لا تعيد بناء التطبيق إلا لو تغيّر الإطار نفسه.

### تطبيق الكمبيوتر (Electron) — `desktop/`

- `main.cjs` ينشئ النافذة، ويسمح بموقعنا فقط بداخلها (أي رابط آخر يفتح في المتصفح العادي)، ويمنع الصفحة من الوصول لـ Node.js، ويعطي صلاحية الكاميرا و USB لموقعنا فقط، ويعرض `offline.html` لو لم يستطع الوصول للموقع أول مرة.
- **وضع الكشك (Kiosk mode)** (`"kiosk": true` في `desktop/app-config.json`) يجعله ملء الشاشة ومقفولًا — مناسب للكاونتر.
- `preload.cjs` هو الجسر الوحيد بين الصفحة والكمبيوتر. حاليًا يشارك رقم النسخة ونوع النظام فقط؛ والخطة تضيف هنا الطباعة المباشرة (Native printing).
- البناء: `cd desktop && npm install && npm run dist:win` ينتج ملف تثبيت Windows في `desktop/dist/`.

### أندرويد (Capacitor) — `mobile/`

- `capacitor.config.json` → `server.url` هو عنوان الموقع الذي يفتحه التطبيق.
- `mobile/android/` مشروع Android Studio عادي أنشأه Capacitor.
- في خطتنا تطبيق أندرويد **للمدير**: التقارير، التنبيهات (إشعارات Push)، الجرد واستلام البضاعة بماسح كاميرا سريع (Native scanner).
- البناء: `cd mobile && npm install && npm run android` يفتح Android Studio؛ اضغط Run، أو Build → Generate Signed Bundle لرفعه على Google Play.

### PWA (بدون متجر)

أي Chrome أو Edge يستطيع "تثبيت" الموقع (أيقونة التثبيت في شريط العنوان). هذا هو البديل لو لا تريد ملفات تثبيت.

---

## 9. تشغيل المشروع على جهازك

تحتاج: **Node.js 22** (من nodejs.org)، و **Git**، وحساب **Supabase** مجاني، ومحرر كود (VS Code).

</div>

```bash
# 1. get the code
git clone https://github.com/abdallah894/cashier-1.git
cd cashier-1

# 2. install the libraries (creates node_modules/)
npm install

# 3. settings: copy the example and fill it
cp .env.example .env.local
#    open .env.local and paste from Supabase → Project Settings → API:
#    NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY

# 4. build the database in your Supabase project
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push           # runs every file in supabase/migrations/

# 5. demo data (admin + cashier users, categories, products) — NEVER on production
npm run seed

# 6. start
npm run dev                    # open http://localhost:3000
```

<div dir="rtl">

سجّل الدخول بـ `SEED_ADMIN_EMAIL` و `SEED_ADMIN_PASSWORD` الموجودين في `.env.local`.

فحوصات يجب تشغيلها قبل كل Commit (و CI يشغّل نفس الشيء):

</div>

```bash
npm run lint         # code style problems
npm run typecheck    # type errors
npm run test:all     # the 36 test suites (in-memory database, no internet needed)
npm run build        # can it build for production?
```

<div dir="rtl">

---

## 10. رفعه على الإنترنت وبناء التطبيقات

1. **مشروع Supabase للإنتاج** (خطة Pro)، ثم `supabase db push` عليه. أوقف التسجيل العام (Public sign-ups).
2. **Vercel**: استورد مستودع GitHub، أضف متغيرات البيئة من `.env.example` (Production)، ثم انشر. أضف الدومين الخاص بك.
3. أنشئ حساب المدير الحقيقي، واضبط أرقام PIN، وأدخل إعدادات المحل، واستورد المنتجات.
4. **الكمبيوتر**: ضع عنوان الموقع في `desktop/app-config.json` ثم ابنِ — أو استخدم GitHub → Actions → "Build apps" → Run workflow واكتب العنوان.
5. **أندرويد**: ضع العنوان في `mobile/capacitor.config.json`، ابنِ حزمة موقّعة (Signed bundle)، وارفعها على Google Play للاختبار الداخلي (Internal testing).

النسخة الكاملة بخانات التأشير هي `docs/operations/go-live-checklist.md`، والخطة الكاملة هي [PRODUCTION-PLAN.md](PRODUCTION-PLAN.md).

---

## 11. التشغيل اليومي وحل المشاكل

| الموقف                   | ماذا تفعل                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------ |
| الإنترنت انقطع           | استمر في البيع كاش؛ الشريط يعرض المبيعات المنتظرة؛ تُرسل وحدها عند رجوع الإنترنت.    |
| بيعة منتظرة "مرفوضة"     | المدير يفتح **Offline sales**، يقرأ السبب (مثلًا المخزون نفد)، ويحلّها.              |
| الطابعة لا تطبع          | افحص الورق والكهرباء و USB؛ أعد الطباعة من **Receipts**؛ استخدم طباعة المتصفح كبديل. |
| الماسح يكتب في مكان خطأ  | تأكد أنه مضبوط ليرسل Enter بعد الكود وبدون بادئة (docs/hardware.md).                 |
| الكاش لا يطابق عند القفل | أعد العدّ؛ سجّل أي سحب نسيته؛ المدير يوافق على الفرق برقم PIN.                       |
| موظف ترك العمل           | المدير → **Users** → إيقاف الحساب؛ غيّر أي كلمات سر مشتركة.                          |
| الموقع لا يعمل           | افتح `https://YOUR-DOMAIN/api/health`؛ وراجع `docs/operations/runbook.md`.           |
| تنبيه النسخ الاحتياطي    | شغّل `scripts/backup-db.sh`؛ وراجع الـ Runbook.                                      |

---

## 12. جدول مقارنة React ↔ Vue

أنت تعرف Vue 3 / Nuxt 3؛ هذه نفس الأفكار في هذا المشروع.

| Vue / Nuxt                              | React / Next.js في هذا المشروع                                          |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `<template>` مع `v-if` و `v-for`        | JSX: `{cond && <X/>}` و `{list.map(i => <Row key={i.id}/>)}`            |
| `ref()` / `reactive()`                  | `useState()` — استدعِ دالة التغيير، ولا تعدّل القيمة مباشرة             |
| `computed()`                            | احسبها مباشرة داخل الدالة، أو `useMemo`                                 |
| `watch()` / `onMounted` / `onUnmounted` | `useEffect(() => { …; return cleanup }, [deps])`                        |
| Composables (`useX`)                    | Custom hooks في `hooks/` (مثل `useBarcodeScanner`)                      |
| Pinia `defineStore`                     | Zustand `create()` — في `lib/store/cart.ts`                             |
| `provide` / `inject`                    | React Context (`components/providers.tsx`)                              |
| Nuxt `server/api/*.ts`                  | Server actions في `lib/actions/` (+ `app/api/` route handlers)          |
| مجلد pages في Nuxt                      | مجلد `app/`؛ `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`       |
| Nuxt route middleware                   | `proxy.ts` (اسم الـ middleware في Next 16)                              |
| `useFetch`                              | الـ Server Components تجلب البيانات مباشرة؛ و TanStack Query في المتصفح |
| `vue-i18n` `$t()`                       | next-intl `useTranslations()` / `getTranslations()`                     |
| مكونات Vuetify                          | مكونات shadcn/ui في `components/ui/`                                    |

---

## 13. ماذا تقرأ بعد ذلك

1. [PROJECT-REVIEW.md](PROJECT-REVIEW.md) — ما هو الخطأ أو الناقص اليوم، بالملفات بالضبط (بالإنجليزية).
2. [PRODUCTION-PLAN.md](PRODUCTION-PLAN.md) — الخطة خطوة بخطوة للإنتاج وتطبيق الكمبيوتر وأندرويد (بالإنجليزية).
3. `docs/operations/go-live-checklist.md` و `docs/operations/runbook.md` — الإطلاق والتشغيل اليومي.
4. `docs/apps.md`, `docs/hardware.md`, `docs/offline-plan.md`, `docs/payments.md`, `docs/reporting.md` — شرح متعمق.
5. `CLAUDE.md` — قواعد المشروع (التقنيات، قواعد العمل، الهيكل).

</div>
