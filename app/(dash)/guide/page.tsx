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
        "Today's top actions — the system ranks every open task and blocker by deadline, stage, follow-up dates and how long something has been stuck. The top of this list is your morning agenda.",
        "What's stuck, and on whom — active blockers with days stuck, who is blocking, and a suggested next move.",
        'Where every project stands — each project shows its own sequence of stages (they differ per project). Click any stage: a completed stage shows what was done, the current stage shows the requirement checklist, a future stage shows what will be required.',
        'Requirements have three states: Done, Open, and Unknown. Unknown means "we have no evidence either way" — it is shown honestly instead of guessing. Each requirement is also marked as ours to do or something the City issues.',
        'Daily tasks — collapsed by default; expand to see all. Every task has a Description column with the tracker context. Add a task manually with the + button, or mark one done.',
        'Decisions this week — grouped by project, click a row for detail. Compare across projects sits at the bottom.',
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
        'הפעולות החשובות להיום — המערכת מדרגת כל משימה פתוחה וכל חסימה לפי דד-ליין, שלב, תאריכי פולואו-אפ וכמה זמן משהו תקוע. ראש הרשימה הוא סדר היום של הבוקר.',
        'מה תקוע ואצל מי — חסימות פעילות עם מספר ימים, מי חוסם, והצעה לצעד הבא.',
        'איפה כל פרויקט עומד — לכל פרויקט רצף שלבים משלו (שונה מפרויקט לפרויקט). לוחצים על שלב: שלב שהושלם מציג מה בוצע, השלב הנוכחי מציג את רשימת הדרישות, ושלב עתידי מציג מה יידרש.',
        'לכל דרישה שלושה מצבים: בוצע, פתוח, ולא ידוע. "לא ידוע" אומר שאין לנו ראיה לכאן או לכאן — מציגים את זה בכנות במקום לנחש. כל דרישה מסומנת גם אם היא עלינו או משהו שהעירייה מנפיקה.',
        'משימות יומיות — מכווץ כברירת מחדל; מרחיבים כדי לראות הכול. לכל משימה עמודת תיאור עם ההקשר מהטרקר. מוסיפים משימה ידנית בכפתור +, או מסמנים שבוצעה.',
        'החלטות השבוע — מקובץ לפי פרויקט, לחיצה על שורה פותחת פירוט. ההשוואה בין פרויקטים נמצאת בתחתית.',
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
        <h1 className="font-serif text-3xl text-ink">{g.title}</h1>
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
