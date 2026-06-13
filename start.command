#!/bin/bash
# ==========================================================
#  השכונתית — הפעלה בלחיצה כפולה (macOS)
#  לחיצה כפולה על הקובץ הזה מריצה את המערכת ופותחת אותה בדפדפן.
# ==========================================================
cd "$(dirname "$0")" || exit 1

echo "🌿 מפעיל את השכונתית..."
echo

# בדיקה ש-Node מותקן
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js לא מותקן."
  echo "   הורידי והתקיני גרסה 22 ומעלה מ: https://nodejs.org"
  echo
  read -p "לחצי Enter לסגירה..."
  exit 1
fi

# בדיקת גרסה (דרוש 18+)
MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$MAJOR" -lt 18 ]; then
  echo "⚠️  גרסת Node שלך היא $(node -v) — דרושה 18 ומעלה."
  echo "   עדכני מ: https://nodejs.org"
  echo
  read -p "לחצי Enter לסגירה..."
  exit 1
fi

# התקנת תלויות בפעם הראשונה
if [ ! -d node_modules ]; then
  echo "📦 מתקין תלויות (חד-פעמי, ייקח דקה)..."
  npm install || { echo "❌ ההתקנה נכשלה"; read -p "Enter לסגירה..."; exit 1; }
fi

# יצירת קובץ הגדרות אם חסר
if [ ! -f .env ]; then
  cp .env.example .env
  echo "📝 נוצר קובץ .env — מלאי בו את SHEETS_API_KEY ואת ADMIN_PASSWORD לפני השימוש."
fi

echo
echo "✅ השרת עולה... הדפדפן ייפתח אוטומטית."
echo "   לעצירה: סגרי את החלון הזה או לחצי Ctrl+C"
echo

# פתיחת הדפדפן אחרי 2 שניות (דף הנחיתה)
( sleep 2 && open "http://localhost:3000/?machine=building_A" ) &

# הרצת השרת
npm start
