import { cookies } from 'next/headers';
import { LOCALE_COOKIE, type Locale } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

interface Section { title: string; body: string[] }
interface GuideContent { title: string; intro: string; sections: Section[] }

const EN: GuideContent = {
  title: 'How to use Sitekick',
  intro: 'Sitekick turns your emails, meeting summaries, invoices and trackers into one operational picture: where every project stands, what is stuck, and what to do today. In the current phase you feed it by uploading files; the automatic mailbox connections are wired and will be switched on later.',
  sections: [
    {
      title: 'The overview page',
      body: [
        "Open today's plan — the first card jumps to My Work, where every open item sits ranked. When agent suggestions await review, an amber banner links to the Inbox.",
        'Where everything stands — one card per project: current phase, parallel workstreams, on-hold / on-track, what must happen next and the main blocker. Tap the header to expand; tap the project name to open its full process page.',
        "What's stuck, and on whom — active blockers with days stuck, who is blocking, and a suggested next move.",
        'Where every project stands — the detailed per-stage rails: click any stage for its requirement checklist. Requirements have three states: Done, Open, and Unknown ("no evidence either way" — shown honestly instead of guessing), and each is marked as ours or something the City issues.',
        'Decisions this week — grouped by project, click a row for detail. Compare across projects sits at the bottom.',
      ],
    },
    {
      title: 'My Work — act here',
      body: [
        'One ranked list of everything open, in five views: Today (the top of the ranking), Blocking, Follow-ups, Waiting, All.',
        'Every row expands with its details and dependencies. Update opens the action menu: Completed, Sent email, Waiting on…, Delayed to…, Scheduled for…, Not applicable, Add note — each updates the task and writes an audit-log entry.',
        'Pin keeps a task on top; Snooze hides it until tomorrow. A Payment Run card appears when approved invoices are ready to pay.',
      ],
    },
    {
      title: 'The review inbox — you stay in control',
      body: [
        'Agents never change your data silently. Safe additions apply automatically; anything that updates or closes an existing item, sets a project phase, or adds a dependency waits here as a proposal, with its confidence and the evidence quote.',
        'Accept applies the change through one audited writer; Reject dismisses it. Either way, the decision is logged.',
      ],
    },
    {
      title: 'Project process pages — the five phases',
      body: [
        'Click a project name anywhere to open its process page. Five fixed phases — Planning, Plan Check, Bidding, Financing, Construction — each a column of sub-stages you can activate, mark done, or set N/A.',
        'Parallel workstreams (a survey running alongside, for example) show as blue chips on their phase, and both phases are lit on the overview cards.',
        'Change the current phase with the switcher, or press "Infer from emails" — Claude reads the recent project communications in two-to-three passes and files a phase suggestion to the Inbox. It never changes the phase directly.',
        "Connected actions lists the project's open tasks grouped by phase — update them and add dependencies between tasks right there.",
      ],
    },
    {
      title: 'Weekly review — prepare Sunday, run Monday',
      body: [
        "Prepare this week's review builds Monday's agenda in one click: open items grouped by project and sub-topic, with everything from last week carried forward with its current status.",
        'During the meeting, mark items Completed or N/A and jot a note per item. Save the review to freeze it; attach the meeting recording (MP4) afterwards.',
      ],
    },
    {
      title: 'Uploading documents (the main input right now)',
      body: [
        'Upload page → drop a file. What happens depends on the type:',
        'PDF — read as an invoice: vendor, amount, number and dates are extracted and a new invoice appears in Received status.',
        'XLSX (Excel) — the Invoices Tracker and the Operations Tracker are recognized automatically by their headers and imported: invoices update their status chain (including "For Rowan Approval"), tasks update existing rows instead of duplicating. Any other spreadsheet is read as text.',
        'DOCX / TXT — treated as a meeting summary or email: tasks, blockers, decisions and deadline changes are extracted. If an item matches an existing open task, that task is updated rather than duplicated.',
        'EML — a saved email file, parsed and processed like an email.',
        'JSONL — a bulk email export: all emails are stored (duplicates skipped), and the newest ten are processed by the agent immediately.',
        'ZIP / OLM — an Outlook (or zipped) mail archive: every email inside is stored, duplicates skipped, and the newest ten processed immediately.',
        'MP4 — a meeting recording: stored and attachable from the Weekly Review page (automatic transcription comes later).',
        'You can pick a project before uploading to help the system attribute the document.',
      ],
    },
    {
      title: 'Invoices',
      body: [
        'Tabs mirror the Excel: Invoices, Payment Summary, David.',
        'Each invoice moves through four states: Received → For Rowan Approval → Approved → Paid. The "For Rowan Approval" queue is highlighted — that is where money waits.',
        'Use the arrow next to a status to advance it. Filters: project, entity (LLC), vendor, status, date range. Transfer confirmation links open the original document.',
      ],
    },
    {
      title: 'Drafts, digest and directory',
      body: [
        'Drafts — when the agent spots a blocker that needs an escalation email, it proposes a draft. You approve, copy or open it in your mail app, and mark it sent. Nothing is ever sent automatically.',
        'Digest — a morning summary (07:00 LA time) with top actions, stuck items, follow-ups due and money waiting on Rowan. Generate one on demand with the button.',
        'Directory — consultants and vendors with contacts and how many open items wait on each.',
      ],
    },
    {
      title: 'Settings',
      body: [
        'Import requirement lists — paste the per-project requirements JSON from the PM; stage checklists update without any code change.',
        'Stage overrides — set the confirmed current stage and substage per project. Confirmed stages show a green check instead of "estimated".',
        'Users & access — add a teammate by email; they get a one-time temp password. Remove access anytime. Only listed users can sign in.',
        'Integrations — status lights for the automatic connections (Gmail, Outlook, Sheets). These stay off until the accounts are approved and connected; uploads cover everything meanwhile.',
      ],
    },
    {
      title: 'Language and theme',
      body: [
        'The עברית / English button switches language (the layout flips to RTL in Hebrew). The moon/sun button switches dark mode. Both are remembered per browser.',
      ],
    },
  ],
};

const HE: GuideContent = {
  title: 'איך משתמשים ב-Sitekick',
  intro: 'Sitekick הופך מיילים, סיכומי פגישות, חשבוניות וטרקרים לתמונה תפעולית אחת: איפה כל פרויקט עומד, מה תקוע, ומה עושים היום. בשלב הנוכחי מזינים אותו בהעלאת קבצים; החיבורים האוטומטיים לתיבות המייל מוכנים ויופעלו בהמשך.',
  sections: [
    {
      title: 'מסך המבט-על',
      body: [
        'פתיחת התוכנית להיום — הכרטיס הראשון מוביל ל"העבודה שלי", שם כל הפריטים הפתוחים מדורגים. כשהצעות של הסוכן ממתינות לבדיקה, באנר כתום מוביל לתיבת הביקורת.',
        'איפה הכול עומד — כרטיס לכל פרויקט: שלב נוכחי, מסלולים מקבילים, בהקפאה / במסלול, מה חייב לקרות עכשיו והחסימה המרכזית. לחיצה על הכותרת מרחיבה; לחיצה על שם הפרויקט פותחת את עמוד התהליך המלא.',
        'מה תקוע ואצל מי — חסימות פעילות עם מספר ימים, מי חוסם, והצעה לצעד הבא.',
        'איפה כל פרויקט עומד — המסילות המפורטות לפי שלב: לוחצים על שלב לרשימת הדרישות. לכל דרישה שלושה מצבים: בוצע, פתוח, ולא ידוע ("אין ראיה לכאן או לכאן" — מוצג בכנות במקום לנחש), וכל דרישה מסומנת אם היא עלינו או של העירייה.',
        'החלטות השבוע — מקובץ לפי פרויקט, לחיצה על שורה פותחת פירוט. ההשוואה בין פרויקטים נמצאת בתחתית.',
      ],
    },
    {
      title: 'העבודה שלי — כאן פועלים',
      body: [
        'רשימה מדורגת אחת של כל מה שפתוח, בחמש תצוגות: היום (ראש הדירוג), חוסם, פולואו-אפים, ממתין, הכול.',
        'כל שורה נפתחת עם הפרטים והתלויות שלה. כפתור "עדכון" פותח את תפריט הפעולות: בוצע, נשלח מייל, ממתין ל…, נדחה ל…, נקבע ל…, לא רלוונטי, הוספת הערה — כל פעולה מעדכנת את המשימה ונרשמת ביומן הפעילות.',
        'נעיצה משאירה משימה למעלה; דחייה מסתירה אותה עד מחר. כרטיס "סבב תשלומים" מופיע כשחשבוניות מאושרות מוכנות לתשלום.',
      ],
    },
    {
      title: 'תיבת הביקורת — השליטה נשארת אצלכם',
      body: [
        'הסוכנים לא משנים נתונים בשקט. תוספות בטוחות נכנסות אוטומטית; כל מה שמעדכן או סוגר פריט קיים, קובע שלב לפרויקט או מוסיף תלות — ממתין כאן כהצעה, עם רמת הביטחון וציטוט הראיה.',
        'אישור מחיל את השינוי דרך כותב מבוקר אחד; דחייה מבטלת. בשני המקרים ההחלטה נרשמת.',
      ],
    },
    {
      title: 'עמודי התהליך — חמשת השלבים',
      body: [
        'לחיצה על שם פרויקט בכל מקום פותחת את עמוד התהליך שלו. חמישה שלבים קבועים — Planning, Plan Check, Bidding, Financing, Construction — כל אחד עמודה של תתי-שלבים שאפשר להפעיל, לסמן כבוצעו או כלא רלוונטיים.',
        'מסלולים מקבילים (למשל סקר שרץ במקביל) מוצגים כתגיות כחולות על השלב שלהם, ושני השלבים נצבעים בכרטיסי המבט-על.',
        'מחליפים שלב נוכחי עם הבורר, או לוחצים "זיהוי שלב מהמיילים" — קלוד קורא את התקשורת האחרונה של הפרויקט בשתיים-שלוש איטרציות ושולח הצעת שלב לתיבת הביקורת. הוא לעולם לא משנה שלב ישירות.',
        'פעולות מקושרות — המשימות הפתוחות של הפרויקט מקובצות לפי שלב; מעדכנים ומוסיפים תלויות בין משימות ישר משם.',
      ],
    },
    {
      title: 'סקירה שבועית — מכינים בראשון, מריצים בשני',
      body: [
        'לחיצה אחת על "הכנת הסקירה" בונה את סדר היום של יום שני: פריטים פתוחים מקובצים לפי פרויקט ותת-נושא, וכל מה שנשאר מהשבוע שעבר עובר קדימה עם הסטטוס הנוכחי.',
        'במהלך הפגישה מסמנים בוצע / לא רלוונטי ורושמים הערה לכל פריט. שומרים את הסקירה כדי לקבע אותה; את הקלטת הפגישה (MP4) מצרפים אחר כך.',
      ],
    },
    {
      title: 'העלאת מסמכים (הקלט המרכזי כרגע)',
      body: [
        'עמוד ההעלאה ← גוררים קובץ. מה שקורה תלוי בסוג:',
        'PDF — נקרא כחשבונית: ספק, סכום, מספר ותאריכים מחולצים, וחשבונית חדשה מופיעה בסטטוס "התקבלה".',
        'XLSX (אקסל) — טרקר החשבוניות וטרקר התפעול מזוהים אוטומטית לפי הכותרות ומיובאים: חשבוניות מתעדכנות בשרשרת הסטטוסים (כולל "לאישור רואן"), ומשימות מעדכנות שורות קיימות במקום לשכפל. כל גיליון אחר נקרא כטקסט.',
        'DOCX / TXT — מטופל כסיכום פגישה או מייל: משימות, חסימות, החלטות ושינויי דד-ליין מחולצים. פריט שמתאים למשימה פתוחה קיימת מעדכן אותה במקום ליצור כפילות.',
        'EML — קובץ מייל שמור, מפוענח ומעובד כמו מייל.',
        'JSONL — ארכיון מיילים: כל המיילים נשמרים (כפילויות מדולגות), ועשרת החדשים ביותר מעובדים מיד.',
        'ZIP / OLM — ארכיון מייל של Outlook (או קובץ מכווץ): כל מייל בפנים נשמר, כפילויות מדולגות, ועשרת החדשים מעובדים מיד.',
        'MP4 — הקלטת פגישה: נשמרת וניתנת לצירוף מעמוד הסקירה השבועית (תמלול אוטומטי בהמשך).',
        'אפשר לבחור פרויקט לפני ההעלאה כדי לעזור למערכת לשייך את המסמך.',
      ],
    },
    {
      title: 'חשבוניות',
      body: [
        'הטאבים משקפים את האקסל: Invoices, Payment Summary, David.',
        'כל חשבונית עוברת ארבעה מצבים: התקבלה ← לאישור רואן ← מאושרת ← שולמה. תור "לאישור רואן" מודגש — שם הכסף מחכה.',
        'החץ ליד הסטטוס מקדם שלב. סינון: פרויקט, ישות (LLC), ספק, סטטוס, טווח תאריכים. לינק אישור העברה פותח את המסמך המקורי.',
      ],
    },
    {
      title: 'טיוטות, תקציר וספקים',
      body: [
        'טיוטות — כשהסוכן מזהה חסימה שדורשת מייל הסלמה, הוא מציע טיוטה. אתם מאשרים, מעתיקים או פותחים באפליקציית המייל, ומסמנים שנשלח. שום דבר לא נשלח אוטומטית.',
        'תקציר יומי — סיכום בוקר (07:00 שעון LA) עם הפעולות החשובות, מה תקוע, פולואו-אפים שהגיע זמנם וכסף שממתין לרואן. אפשר להפיק גם ידנית בכפתור.',
        'ספקים — יועצים וספקים עם אנשי קשר וכמה פריטים פתוחים ממתינים אצל כל אחד.',
      ],
    },
    {
      title: 'הגדרות',
      body: [
        'ייבוא רשימות דרישות — מדביקים את ה-JSON של הדרישות מה-PM; רשימות השלבים מתעדכנות בלי שינוי קוד.',
        'קיבוע שלבים — קובעים שלב נוכחי ותת-שלב מאושרים לכל פרויקט. שלב מאושר מוצג עם וי ירוק במקום "הערכה".',
        'משתמשים והרשאות — מוסיפים חבר/ת צוות לפי אימייל; הם מקבלים סיסמה זמנית חד-פעמית. אפשר להסיר גישה בכל רגע. רק משתמשים רשומים יכולים להתחבר.',
        'אינטגרציות — נוריות סטטוס לחיבורים האוטומטיים (Gmail, Outlook, Sheets). הם כבויים עד שהחשבונות יאושרו ויחוברו; בינתיים ההעלאות מכסות הכול.',
      ],
    },
    {
      title: 'שפה ותצוגה',
      body: [
        'כפתור עברית / English מחליף שפה (הפריסה מתהפכת ל-RTL בעברית). כפתור הירח/שמש מחליף מצב כהה. שתי ההעדפות נשמרות בדפדפן.',
      ],
    },
  ],
};

export default async function GuidePage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const g = locale === 'he' ? HE : EN;

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-16">
      <div>
        <h1 className="font-serif text-2xl text-ink sm:text-3xl">{g.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink2">{g.intro}</p>
      </div>
      {g.sections.map((s) => (
        <section key={s.title} className="rounded-(--radius-card) border border-line bg-card p-5 shadow-card">
          <h2 className="text-base font-semibold text-ink">{s.title}</h2>
          <ul className="mt-2 space-y-2">
            {s.body.map((p, i) => (
              <li key={i} className="text-sm leading-relaxed text-ink2">{p}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
