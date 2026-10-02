# Running in production on a Windows PC

This runs the whole service (website, api, database, document storage) in
Docker on one Windows PC, and puts it on the internet at
`https://srikrishnlegaloffice.in` through a **Cloudflare Tunnel**.

The tunnel is why this works from a home or office connection:

- **No router setup:** you don't open any ports on your router, and you don't need a fixed IP address.
- **Nothing exposed:** the PC itself takes no connections from the internet.
- **https is automatic:** Cloudflare provides the certificate for free.

The scripts live in `deploy\windows\`. You'll mostly use **Start service.bat**.

## What you need

- **The PC:** Windows 10 or 11, 64-bit, with at least 8 GB of RAM (16 GB is better) and 50 GB of free disk space. It has to stay switched on and connected.
- **[Docker Desktop](https://www.docker.com/products/docker-desktop/)**, with the default WSL 2 setting.
- **[Git for Windows](https://git-scm.com/download/win).**
- **Accounts:** a free [Cloudflare](https://dash.cloudflare.com/sign-up) account, the Razorpay account in **Live** mode, and an email account that can send mail. For Gmail, that means an app password.
- **Ideally, a UPS.** A power cut takes the site down until the PC is back on.

## 1. Get the code onto the PC

Open **PowerShell** and run:

```powershell
cd C:\
git clone <your repository URL> LegalFiling
cd C:\LegalFiling
```

Use a short path without spaces, like `C:\LegalFiling`.

## 2. Move the domain's DNS to Cloudflare

Do this once:

1. In Cloudflare, choose **Add a domain** and enter `srikrishnlegaloffice.in`. Pick the Free plan.
2. Cloudflare shows two nameservers. Where you bought the domain, replace the domain's nameservers with those two.
3. Wait until Cloudflare emails to say the domain is active. That usually takes minutes, but can take up to a day.

## 3. Create the tunnel

1. In Cloudflare, go to **Zero Trust → Networks → Tunnels → Create a tunnel**. Choose **Cloudflared** and name it `legal-filing`.
2. Under "Install and run a connector", choose **Docker**. Copy only the long token after `--token` in the command it shows. Keep it for step 4.
3. Under **Public Hostnames**, add both of these:

   | Subdomain | Domain                  | Service type | URL            |
   |-----------|-------------------------|--------------|----------------|
   | *(empty)* | srikrishnlegaloffice.in | HTTP         | `web:80`       |
   | `files`   | srikrishnlegaloffice.in | HTTP         | `storage:8333` |

   The second hostname is where browsers upload and download documents.

## 4. First start, which creates the settings file

Double-click **`deploy\windows\Start service.bat`**.

The first time, it creates `C:\LegalFiling\.env.production`, filled with new random passwords, and then stops. Open that file:

```powershell
notepad C:\LegalFiling\.env.production
```

Replace every `CHANGE_ME`:

- **`CLOUDFLARE_TUNNEL_TOKEN`:** the token from step 3.
- **`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`:** in the Razorpay dashboard, switch to **Live mode**, then go to **Account & Settings → API Keys**.
- **`RAZORPAY_WEBHOOK_SECRET`:**
  1. In Razorpay, go to **Webhooks → Add New Webhook**.
  2. Set the URL to `https://srikrishnlegaloffice.in/api/webhooks/razorpay`.
  3. Choose a secret and put the same secret here.
  4. Tick the events `payment.captured`, `payment.failed` and `refund.processed`.
- **`SMTP_*`:** the email account the service sends from.

Also fill in `SUPPORT_EMAIL` and `SUPPORT_PHONE` if you want them shown on the Help page.

For **Sign in with Google**, put the same OAuth client ID in both `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID`. In Google Cloud Console, add `https://srikrishnlegaloffice.in` as an authorised JavaScript origin. To leave Google sign-in off, keep both empty.

Save, then double-click **Start service.bat** again. The first build takes about 5–15 minutes. When it finishes, it prints **Done** and says whether the site is reachable from the internet.

> **Keep `.env.production` private.** It holds every password the service uses. It's ignored by git, so it never gets committed. Don't email it or put it in a shared folder.

## 5. Create the advocate's account

People can only register as lawyers, so the advocate's account is made here:

```powershell
cd C:\LegalFiling
powershell -ExecutionPolicy Bypass -File deploy\windows\create-admin.ps1
```

It asks for the email, name, Bar Council enrolment number and a password. Then sign in at `https://srikrishnlegaloffice.in`.

## 6. Keep it running unattended

1. **Docker Desktop:** go to **Settings → General** and turn on **Start Docker Desktop when you sign in**.
2. **Windows:** go to **Settings → System → Power** and set **Sleep** to **Never** when plugged in.
3. Run once:

   ```powershell
   powershell -ExecutionPolicy Bypass -File deploy\windows\install-tasks.ps1 -BackupDestination D:\LegalFilingBackups
   ```

   This creates two Task Scheduler tasks:
   - start the service every time you sign in;
   - back it up every night at 2 am.

   Their output goes to `C:\LegalFiling\logs\`.

**After Windows Update restarts the PC**, Docker Desktop doesn't start until someone signs in, so the site stays down until then. Either sign in after each restart, or set Windows to sign in automatically:

1. Press Win+R and run `netplwiz`.
2. Untick "Users must enter a user name and password". On Windows 11, first turn off **Settings → Accounts → Sign-in options → "For improved security, only allow Windows Hello sign-in"**.

Automatic sign-in means anyone who can touch the PC can use it, so only do this if the PC is somewhere physically secure. Lock the screen (Win+L) when you step away; the service keeps running.

## 7. Backups

Each backup is a dated folder holding `database.dump`, `documents.tar.gz` and `env.production`. It contains every client document and password, so treat it as confidential.

The nightly task keeps 30 days of backups. To back up right now, double-click **Back up now.bat**.

A backup on the same disk doesn't survive that disk failing. **At least weekly, copy the latest backup folder off the PC**, to an external drive kept elsewhere or to encrypted cloud storage.

**To restore**, for example on a new PC after a failure:

1. Do steps 1–3 on the new PC.
2. Copy the backup folder over.
3. Copy its `env.production` to `C:\LegalFiling\.env.production`.
4. Run **Start service.bat** once.
5. Run the restore:

   ```powershell
   powershell -ExecutionPolicy Bypass -File deploy\windows\restore.ps1 -From D:\LegalFilingBackups\2026-10-01_0200
   ```

Try a restore once on a spare PC while nothing is at stake, so you know it works before you need it.

## Updating to a new version

```powershell
cd C:\LegalFiling
git pull
```

Then double-click **Start service.bat**. It rebuilds, applies any database changes and restarts. The site is unavailable for about a minute.

## Everyday commands

Run these from `C:\LegalFiling`:

| To                         | Run                                                                                 |
|----------------------------|-------------------------------------------------------------------------------------|
| Start or update            | **Start service.bat**                                                               |
| Stop                       | **Stop service.bat**                                                                |
| See what's running         | `docker compose -p legal-filing-prod ps`                                            |
| Read the api's recent logs | `docker compose -p legal-filing-prod logs --tail 100 api`                           |
| Check the tunnel           | `docker compose -p legal-filing-prod logs --tail 30 cloudflared`                    |

## If something's wrong

- **"Docker isn't installed / didn't start":** open Docker Desktop and wait until it says it's running, then try again.
- **The script lists settings to fix:** do what each line says in `.env.production`, then run it again.
- **"The site isn't reachable yet" but everything is running:** check the tunnel's logs (above). They should say "Registered tunnel connection". Also check both public hostnames from step 3 exist.
- **Documents won't upload or download:** the `files.` public hostname is missing, or `S3_ENDPOINT_URL` doesn't match it.
- **Payments don't confirm:** in Razorpay, open the webhook and look at its recent deliveries. The URL and secret must match step 4.
