# DeskSOS Enterprise: user guide for operators and viewers

DeskSOS Enterprise is the operations dashboard where IT incidents arrive and are worked on. That includes tickets that technicians create in the DeskSOS Desktop app. Critical incidents raise an on-screen strobe and, if you've turned it on, an audible alarm.

**Address:** **https://FORD-DC01:5543**. It works from the office network only.

Administrators: managing users is covered in the [operations runbook](OPERATIONS.md), §6.

---

## 1. What you can do

| | Viewer | Operator | Admin |
|---|---|---|---|
| See incidents, their details and history | ✅ | ✅ | ✅ |
| Hear and see Critical alarms | ✅ | ✅ | ✅ |
| Log a new incident | | ✅ | ✅ |
| Mark In Progress / Resolve | | ✅ | ✅ |
| Lock an incident to yourself (by selecting it) | | ✅ | ✅ |
| Manage users | | | ✅ |

Your name and role are shown in the header, for example "Jane Doe (operator)".

---

## 2. Signing in

1. Open **https://FORD-DC01:5543** in Edge or Chrome.
2. Enter your email and password, then click **Sign in**.

**First sign-in:** your administrator gives you a temporary password, in person or by phone, never by email. After you sign in, the **Choose a new password** screen asks for:

- **Current password:** the temporary one
- **New password (at least 12 characters)** and **Confirm new password**

Click **Set password**. You can't do anything else until you've done this.

**Change your password later:** click **Change password** in the header. Your other open sessions are signed out.

**Sign out:** click **Sign out**.

If an administrator changes your role, resets your password or deactivates you, your session ends within about 15 seconds, with the message "Your session has ended. Please sign in again."

| Problem | What to do |
|---|---|
| "Invalid email or password" | Check the email address. If you've forgotten your password, ask an administrator to reset it |
| "Too many failed sign-in attempts" | Wait 15 minutes, then try again carefully |
| The browser warns that the connection isn't private | This PC doesn't trust the DeskSOS certificate yet. Ask your administrator; it's a one-time fix per PC. Don't click through the warning |
| The page doesn't load at all | You're not on the office network, or the server is down. Tell your administrator |

---

## 3. The dashboard at a glance

**Header (left to right):**

| Item | Meaning |
|---|---|
| **🔇 Click to Arm Audio** / **🔊 Tactical Audio: Armed** | Turns on the audible alarm for Critical incidents (§4) |
| **Gateway: Online / Offline** | Whether the dashboard can reach the server. If it shows **Offline**, nothing new will appear: tell your administrator |
| **Users** | Admins only: user management |
| Your name and role, **Change password**, **Sign out** | |

**Counters:**

| Counter | Counts |
|---|---|
| **Critical Alerts** | Incidents with severity CRITICAL, **including resolved ones** |
| **High Severity** | Incidents with severity HIGH, including resolved ones |
| **Total Active** | Incidents that aren't Resolved: your open workload |
| **Resolved (Cycle)** | Resolved incidents |

Use **Total Active** to judge the current workload. Critical Alerts and High Severity don't drop when an incident is resolved.

**Panels:**

- **Live Incident Stream:** newest first. Each card shows the title, severity, category, time, and a 🔒 name if someone has locked it. New incidents appear on their own; you never need to refresh.
- **Incident Inspection Console:** the details of the incident you've selected.
- **Log New Incident Ticket:** operators and admins only.

---

## 4. Critical alarms

When a **CRITICAL** incident arrives (from DeskSOS Desktop or logged here):

- The whole page gets a red border, and the banner **"TACTICAL STROBE ACTIVE: UNACKNOWLEDGED CRITICAL THREAT DETECTED"** appears.
- If audio is armed, you hear a short alert tone and a voice says "Critical alert received: *title*".

**Turn on the sound:** click **🔇 Click to Arm Audio** once. You'll hear a test beep and "Tactical audio armed", and the button changes to **🔊 Tactical Audio: Armed**.

- Browsers only allow sound after you click on the page, so **arming resets every time the page reloads** (refresh, restart, or signing in again). Re-arm it each time.
- Check that the PC's volume is up and that the browser tab isn't muted.

**Clear the strobe:** click **Acknowledge & Silence Strobe**. This only clears your screen. It doesn't change the incident. Then select the incident and deal with it.

**The alarm only plays in dashboards that are open.** For a monitoring station, keep one dashboard open with audio armed on a PC with speakers.

---

## 5. Working on incidents (operators and admins)

### 5.1 Select and lock

Click an incident in the **Live Incident Stream**. Its details open in the **Incident Inspection Console**, and it's **locked to you**: others see 🔒 with your name.

| Detail | What it shows |
|---|---|
| Category, Assigned To, Logged Time | |
| **Source** | Present only for incidents from other systems, for example `desksos-desktop-prod · T-12345678 · requested by …` (the Desktop ticket number and who reported it) |
| **Diagnostic Summary** | The full description, including the diagnostic report for Desktop tickets |
| **History** | Every change with who made it and when: Created, Received from …, Open → In Progress, Locked |

- Locks show who's working on what. They don't stop someone else from changing the status, so check the 🔒 name before acting on someone else's incident.
- A lock is released when the incident is resolved, or when the server restarts.
- **Clear Selection** closes the console. It doesn't release your lock.

### 5.2 Change the status

With the incident selected:

- **Mark In Progress** when you start work.
- **Resolve Incident** when it's done.

Everyone's dashboard updates at once, and the change is recorded in History.

### 5.3 Log a new incident

Use **Log New Incident Ticket** for issues that don't come in through DeskSOS Desktop:

| Field | Notes |
|---|---|
| **Incident Title** | Required. A short summary |
| **Detailed Description** | Required. What happened, what's affected, what you've tried |
| **Category** | Infrastructure, Database, Network or Security |
| **Severity Level** | CRITICAL, HIGH, MEDIUM or LOW. **CRITICAL sets off the alarm on every open dashboard**, so use it only for urgent, business-stopping problems |
| **Assigned To** | Pre-filled with `Node-Ops-Lead`. Change it to the person or team responsible |
| **Latitude / Longitude** | Pre-filled with sample coordinates. Leave or clear them; they aren't used for anything else yet |

Click **Submit Ticket**. The form clears and the incident appears at the top of the stream.

- **If it doesn't appear,** the server didn't accept it. Check **Gateway: Online** and try again.
- **Your typing is kept** when this happens, because the form only clears on success.

---

## 6. Viewers

Viewers see everything in §3 and §4, can select incidents to read their details and history, and get the Critical alarms. They can't log incidents or change them, and selecting an incident doesn't lock it. This suits wall screens and managers.

---

## 7. Getting help

**[Support contact: to be filled in by the owner (plan task 6.4)]**

When you report a problem with the dashboard itself, include:

- what you were doing
- the time
- what you saw, ideally a screenshot. **Never include a password in a screenshot.**
