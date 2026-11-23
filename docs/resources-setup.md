# Resources: one-time setup (project `jalex-hub`)

What this sets up: the private bucket and the Firestore database behind `/resources/`, the
`admin` App Engine service for uploading tools, with its own "Sign in with Google" (step 7).
Do the steps in this order. Every command names `--project=jalex-hub`, so it can't land in another project.

Names used below (change them in `app.yaml` and `admin/admin.yaml` too if you pick others):

| Thing | Name |
|---|---|
| Bucket | `gs://josediaz-tutoring-res` (us-east1, private) |
| Firestore database | `(default)` (Native mode, us-east1; already exists) |
| Service account (both services) | `jalex-hub@appspot.gserviceaccount.com` (App Engine default, already exists) |
| Admin URL | `https://admin-dot-jalex-hub.ue.r.appspot.com` |

## 1. Enable the APIs

Secret Manager is already on (for `site-pricing`).

```bash
gcloud services enable firestore.googleapis.com storage.googleapis.com --project=jalex-hub
```

## 2. Firestore database

First see what exists:

```bash
gcloud firestore databases list --project=jalex-hub
```

- **Nothing listed:** create the default database in Native mode, in the App Engine region:

  ```bash
  gcloud firestore databases create --location=us-east1 --type=firestore-native --project=jalex-hub
  ```

  Keep `FIRESTORE_DATABASE: "(default)"` in `app.yaml` and `admin/admin.yaml`.

- **A `(default)` database with `type: DATASTORE_MODE` is listed:** it can't be used through the
  Firestore API and can't be switched once it has data. Create a separate named database:

  ```bash
  gcloud firestore databases create --database=resources --location=us-east1 --type=firestore-native --project=jalex-hub
  ```

  Then set `FIRESTORE_DATABASE: "resources"` in **both** `app.yaml` and `admin/admin.yaml`.

- **A `(default)` database with `type: FIRESTORE_NATIVE` is listed:** nothing to create. The app only
  uses the collections `resources` and `meta`.

No indexes are needed (the site reads the whole `resources` collection, which is small).

## 3. The private bucket

The bucket `gs://josediaz-tutoring-res` already exists. Check that it's private:

```bash
gcloud storage buckets describe gs://josediaz-tutoring-res --format="table(location,uniform_bucket_level_access,public_access_prevention)"
```

You want `uniform_bucket_level_access` = `True` and `public_access_prevention` = `enforced`. If either isn't:

```bash
gcloud storage buckets update gs://josediaz-tutoring-res --uniform-bucket-level-access --public-access-prevention
```

(Starting over in another project: `gcloud storage buckets create gs://NAME --location=us-east1 --uniform-bucket-level-access --public-access-prevention --project=jalex-hub`, then put NAME in `RESOURCES_BUCKET` in both yaml files.)

Objects are never public: the site streams them (`/frame/...`, `/resources/og/...`).

## 4. Permissions

Both services (the public site and `admin`) run as the App Engine default service account,
`jalex-hub@appspot.gserviceaccount.com`. In this project it has the project-wide **Editor** role, which
already covers reading and writing Firestore and the bucket, so **there's nothing to grant**. Check:

```bash
gcloud projects get-iam-policy jalex-hub --flatten="bindings[].members" --filter="bindings.members:jalex-hub@appspot.gserviceaccount.com" --format="value(bindings.role)"
```

If `roles/editor` is listed (it was on 2026-11-23), go to step 5. If you ever remove Editor from that
account, grant these instead:

```bash
gcloud storage buckets add-iam-policy-binding gs://josediaz-tutoring-res --member=serviceAccount:jalex-hub@appspot.gserviceaccount.com --role=roles/storage.objectAdmin
```

```bash
gcloud projects add-iam-policy-binding jalex-hub --member=serviceAccount:jalex-hub@appspot.gserviceaccount.com --role=roles/datastore.user --condition=None
```

(A stricter setup gives the admin its own service account with write access and leaves the public
site read-only. With Editor on the default account that buys little, so it isn't used here.)

## 5. Deploy the public site (default service)

```bash
gcloud config get-value project
```

```bash
npm run build && npm test
```

```bash
gcloud app deploy app.yaml --project=jalex-hub
```

`/resources/` now shows the empty state. The home page's tools section stays hidden until something is
published, and the sitemap only lists the library once there's a tool.

## 6. Deploy the admin service

Put your Google account in `ADMIN_EMAILS` in `admin/admin.yaml` (comma-separated for more than one).
Then:

```bash
gcloud app deploy admin/admin.yaml --project=jalex-hub
```

Until step 7 is done, the admin answers with an error instead of the sign-in: nobody gets in.

## 7. Google sign-in for the admin

App Engine can only turn IAP on for the **whole** app, never for one service, so IAP would put the
public site behind a login. The admin does "Sign in with Google" itself instead (`admin/auth.js`):
Google's sign-in page, then only the accounts in `ADMIN_EMAILS` get in (12-hour session).

> **Leave IAP off.** In Security → Identity-Aware Proxy, the **App Engine app** switch must stay off.
> Never run `gcloud iap web enable --resource-type=app-engine`.

### 7.1 OAuth consent screen (once)

Console → **Google Auth Platform** (older consoles: **APIs & Services → OAuth consent screen**).

1. If it shows **Get started**: App name `Jose Diaz Tutoring admin`, support email `jadiazlab@gmail.com`,
   Audience **External**, contact email `jadiazlab@gmail.com` → **Create**.
2. **Audience → Test users → Add users →** `jadiazlab@gmail.com` → **Save**. Leave it on **Testing**: only
   test users can sign in at all, an extra lock on top of `ADMIN_EMAILS`.

### 7.2 OAuth client (done: "IAP admin", `836480703321-h8q56orgjo937vrjgnq589psdrrc9g0f.apps.googleusercontent.com`)

**Google Auth Platform → Clients → IAP admin.**

- **Authorized JavaScript origins:** none.
- **Authorized redirect URIs:** exactly this one (remove the `iap.googleapis.com` one if you added it):

  ```
  https://admin-dot-jalex-hub.ue.r.appspot.com/auth/callback
  ```

- **Save.** (Google can take a few minutes to apply it.)

The client ID is already in `admin/admin.yaml` (`OAUTH_CLIENT_ID`), with `ADMIN_BASE_URL` and `ADMIN_EMAILS`.

### 7.3 Client secret in Secret Manager

Paste the client secret when asked (it isn't shown or saved anywhere else):

```bash
read -s -p "Client secret: " S; echo; printf '%s' "$S" | gcloud secrets create admin-oauth-client-secret --data-file=- --replication-policy=automatic --project=jalex-hub; unset S
```

Let the app read it (the Editor role doesn't include reading secret values):

```bash
gcloud secrets add-iam-policy-binding admin-oauth-client-secret --member=serviceAccount:jalex-hub@appspot.gserviceaccount.com --role=roles/secretmanager.secretAccessor --project=jalex-hub
```

New secret later (e.g. you reset it in the console): `gcloud secrets versions add admin-oauth-client-secret --data-file=-`
the same way. Everyone is signed out within 10 minutes.

### 7.4 Deploy the admin

```bash
gcloud app deploy admin/admin.yaml --project=jalex-hub
```

### 7.5 Check

In a **private window**:

1. `https://josediaztutoring.com/` loads with **no** sign-in.
2. `https://josediaztutoring.com/admin` → Google's sign-in → choose `jadiazlab@gmail.com` → the **Resources** list.
3. **Sign out** (top right) works.

### 7.6 If it doesn't work

| What you see | Cause | Fix |
|---|---|---|
| `Sign-in isn't set up correctly: secret admin-oauth-client-secret: HTTP 403` | The app can't read the secret | 7.3, second command |
| `… HTTP 404` | The secret doesn't exist | 7.3, first command |
| `Error 400: redirect_uri_mismatch` (Google) | The redirect URI on the client isn't exactly 7.2's | Fix it in 7.2; wait 5 minutes |
| `Access blocked: … has not completed the Google verification process` | Your account isn't a test user | 7.1 step 2 |
| "Not allowed" page after choosing the account | That account isn't in `ADMIN_EMAILS` | Sign in with `jadiazlab@gmail.com`, or add the account to `ADMIN_EMAILS` and redeploy |
| "Sign-in failed" page | Google refused the code (often a wrong secret) | `gcloud app logs read --service=admin --project=jalex-hub --limit=20 \| grep "Admin:"`; redo 7.3 with `versions add` |
| `/admin` gives the site's 404 page | The public site wasn't redeployed after the `/admin` change | `gcloud app deploy app.yaml --project=jalex-hub` |

## 8. First tool

In the admin: **New resource** → drop the HTML file → fill both languages → **Preview page EN/ES** →
tick *I checked the formulas and the Spanish* → **Publish**. It's live at `/resources/<slug>/` and
`/es/recursos/<slug>/` within about 30 seconds. Then run `npm run indexnow -- --urls /resources/ /es/recursos/ /resources/<slug>/ /es/recursos/<slug>/`
so Bing and others hear about it.

## Local development

```bash
npm install --prefix admin
```

```bash
npm run dev
```

```bash
npm run admin:dev
```

The public dev server (`http://localhost:8080`) and the admin (`http://localhost:8081`, no sign-in) share
the folder `.dev-data/resources` (gitignored) instead of Firestore and Cloud Storage. `npm test` covers both.

## Costs

The bucket holds a few MB. Firestore reads are about one per 15 seconds per instance while there's
traffic, plus one list read per publish, which is far inside the free tier. The admin scales to zero. Google sign-in is free.
