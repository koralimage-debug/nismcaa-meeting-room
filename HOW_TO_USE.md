# How to officially use the NISMCAA Meeting Room

A plain guide for volunteers and for the two administrators (John and Abisade).
The Meeting Room is a **volunteer role: no salary and no fees**. Nobody is ever asked to pay.
The only business phone number is **(470) 739-0021**. The only e-mail is **info@nismcaa.com**.
The site never sends e-mail, so everything is checked by signing in.

---

## For volunteers

### Step 1. Sign up
1. Open the Meeting Room site and choose **Sign up**.
2. Fill in: full name, e-mail (this is your sign-in ID), a password (10 or more characters), phone number, **the country where you live**, a clear photo (JPG or PNG, up to 2 MB), and tick the box that you are 18 or older.
3. Countries you can choose: United States, Nigeria, Canada, United Arab Emirates, United Kingdom, Australia.
   If your country is not listed, choose **My country isn't listed**. We then only record your interest. You do not get access yet.
4. Your photo is private. Only you and the NISMCAA administrators can see it.

### Step 2. Read the course
Open **Volunteer course** (anyone can read it, even without signing in). Read all twelve orientation lessons and all seven Child Care & Protection lessons.

### Step 3. Take the final test
1. Sign in and open **Final test** (from the course page or your Meeting Room page).
2. Answer all 50 questions and press **Submit**.
3. To pass you need **at least 40 of 50 (80%)** and **at least 9 of the 10 child-protection questions** (questions 41 to 50).
4. You see your score but not which answers were wrong. If you do not pass, read the course again and retake the test. There is no limit on tries.
5. If you see **"Result pending key"**, the official answer key has not been entered yet. Your answers are saved and will be marked later. You do nothing.

### Step 4. Wait for approval
When you pass, your status becomes **Waiting for approval**. An administrator reviews your application, checks your country (and may correct it), chooses your department and approves you. **We do not send e-mail**, so sign in again after a few days to see your status.
If you are not approved you will see "Not approved at this time."

### Step 5. Your ID card
After approval you get a unique ID such as **NISMCAA-VOL-0001**. Open **My ID card** to see it and download it as a **PNG** or **PDF**.
- It is valid for **1 year** and is renewable subject to performance (your department head's remarks and an administrator's review).
- The QR code opens a public check page that shows only your name, role, country and whether the ID is VALID, EXPIRED or ENDED.
- The card does not give you unsupervised access to children.
- After approval you cannot change your country or department. Ask an administrator if something is wrong.

### Step 6. Use the Meeting Room
- **Join call**: the gold button on the Meeting Room page opens the team's free video link in a new tab.
- **Chat**: the Organizers' general chat (all approved volunteers and admins) and your own country room. Text only. Adults only. Be respectful. The chat refreshes by itself every 10 seconds. You can send 5 messages every 10 seconds. Administrators can read everything and delete messages.
- **Notes**: type your own meeting notes by hand. Choose **Private** (only you and the administrators) or **Share with my country**.
- **Action plan**: pick a department tab of your country. You see tasks, owners, dates and a flag (green, amber, red or not flagged). If you are the owner of a task you can update its **Status** and **% progress**. Everything else is read-only for you. You can export the tab to Excel/CSV.
- **Work log**: open a task ("Details and work log") and add short dated entries about what you did. Only you can edit or delete your own entries. Your department head and the administrators can read them.
- **Head remarks**: your department head writes remarks about your contribution. You see only your own remarks (My work log and remarks).

### Forgot your password?
There is no "forgot password" e-mail. Contact an administrator (info@nismcaa.com or (470) 739-0021). They give you a one-time temporary password, and you choose your own at your next sign-in.

---

## For administrators (John and Abisade)

### First time only: claim your account
Your account exists but has no password. The person who runs the server gives each of you a **one-time claim code** (shown on the server screen at first start and saved in `ADMIN_CLAIM_CODES.txt` in the data folder).
1. Open `/admin/claim`.
2. Enter **your own** administrator e-mail, your claim code, and choose your own password (10 or more characters).
3. The code works once. When both of you have claimed, the page switches itself off and the code file is deleted.

### Every day
1. **Waiting for approval** (red number on the Admin menu). Each person shows name, e-mail, phone, the country they chose, best score, date passed and photo.
   - Check the country. Change it if it is wrong.
   - Choose the **department** (ten per country) and press **Approve and issue ID**. The volunteer gets a unique ID and a 1-year card. After this the volunteer cannot change country or department; only you can (People, then the person).
   - Or **Decline** with a private reason (only administrators see it; the volunteer sees "Not approved at this time.").
2. **People**: search everyone, open a person to see their test attempts, change placement, reset their password (a one-time temporary password appears on your screen only, and they must change it at next sign-in), or manage their ID.
   - People who chose "My country isn't listed" are on the **interest list**: you can assign a supported country so they can take the test.
3. **ID renewal** (on the person's page): **Renew 1 year**, **Decline renewal** (ID stays valid until its end date), or **End ID** (access stops). Look first at the department head's remarks and the work log. Every action is logged.
4. **Head seats**: every department starts with an empty seat. Until you assign a head, you act as head. A head must be an approved volunteer of that country who passed the course. You can replace or empty a seat at any time.
5. **Settings**: set the **Join call** link (Google Meet, Jitsi or similar, must start with https://). One main link, and an optional link per country. Also the QR base address for ID cards (keep the default unless told otherwise).
6. **Chat**: you can open every room. Delete a message with the red Delete button (it is logged).
7. **Action plan**: open any country, or the **Global roll-up** (totals per country). You can edit every field of a task, link a task to its owner (a volunteer who can then update status and %), add tasks, or delete tasks. Every change is written to the **Change log** (who, what, old value, new value, when).
8. **Export**: Dashboard, then People / Test attempts / Change log as CSV (opens in Excel). These files contain personal data: keep them private.

### One job that is still open: the answer key
The 50 questions have **no answer key yet**. Until you enter it, every test shows "pending key" and nobody can pass.
1. Open **Answer key** in the Admin menu.
2. Paste the key, one answer per line: `1:B`, `2:A`, ... `50:C` (you can paste in pieces).
3. When all 50 are saved, press **Grade the saved attempts now** so people who already took the test get their result.

### Privacy rules to remember
- Never share the sign-in of the admin accounts.
- Photos, phone numbers and test scores are only visible to administrators (and each person sees their own).
- Do not post personal details of children in chat or notes.
