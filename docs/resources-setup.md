# Resources: one-time setup (project `jalex-hub`)

What this sets up: the private bucket and the Firestore database behind `/resources/`, the
`admin` App Engine service for uploading tools, and Google sign-in (IAP) in front of that service only.
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
gcloud services enable firestore.googleapis.com storage.googleapis.com iap.googleapis.com --project=jalex-hub
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

Until IAP is on (next step), every admin URL answers **403 Forbidden**: the code refuses any request that
doesn't carry IAP's signed header. Nothing is exposed in between.

## 7. Turn on Google sign-in (IAP) for the `admin` service only

Where you are before this step: the admin is deployed with your email in `ADMIN_EMAILS`, and every
admin URL answers "Forbidden". The admin's log says `no IAP header`. This step makes Google ask you
to sign in first.

> **Never run `gcloud iap web enable --resource-type=app-engine`** (with or without OAuth flags). It
> turns IAP on for the whole App Engine app, including the public site, and every visitor would get a
> Google sign-in page. Use the console's per-service switch (7.4).

### 7.1 OAuth consent screen (once)

Console → **Google Auth Platform** (older consoles: **APIs & Services → OAuth consent screen**).

1. If it shows **Get started**: App name `Jose Diaz Tutoring admin`, User support email `jadiazlab@gmail.com`,
   Audience **External**, Contact email `jadiazlab@gmail.com`, accept the policy, **Create**.
2. **Audience** → **Test users** → **Add users** → `jadiazlab@gmail.com` → **Save**. Leave the
   publishing status on **Testing**: only test users can sign in, which is what you want.

### 7.2 OAuth client

A personal (non-Workspace) project needs its own client; Google's built-in one only works inside a
Workspace organization.

1. **Google Auth Platform → Clients → Create client** (older: **APIs & Services → Credentials → Create
   credentials → OAuth client ID**).
2. Application type **Web application**. Name `IAP admin`.
3. **Authorized JavaScript origins:** leave empty. **Authorized redirect URIs:** leave empty for now.
4. **Create**. A box shows the **Client ID** and the **Client secret**. Copy both somewhere safe
   (or download the JSON). Never paste the secret into a chat or a file in the repo.

### 7.3 Redirect URI

In Cloud Shell, paste the Client ID when asked; it prints the exact line to add:

```bash
read -p "Client ID: " CLIENT_ID; echo; echo "https://iap.googleapis.com/v1/oauth/clientIds/${CLIENT_ID}:handleRedirect"
```

Back in the console: **Clients** → **IAP admin** → **Authorized redirect URIs** → **Add URI** → paste
that line → **Save**. (JavaScript origins stay empty.)

### 7.4 Switch IAP on for `admin`

1. Console → **Security → Identity-Aware Proxy**. If it asks to enable the API, enable it.
2. **Applications** tab. Expand **App Engine app**: you see one row per service, `default` and `admin`.
3. Give IAP your client: on the **App Engine app** row, open **⋮ → Settings** (on some consoles, the
   switch in step 4 asks for it instead). Choose the **custom OAuth** option and paste the Client ID
   and Client secret from 7.2. **Save**.
4. Turn on the switch on the **`admin`** row only. Confirm. The `default` row and the App Engine app
   switch stay **off**.
   - If there are no per-service rows, only one switch for the whole app: **stop**, don't turn it on.

### 7.5 Let your account through IAP

```bash
gcloud iap web add-iam-policy-binding --resource-type=app-engine --service=admin --member=user:jadiazlab@gmail.com --role=roles/iap.httpsResourceAccessor --project=jalex-hub
```

### 7.6 Check (wait 2–3 minutes after 7.4)

In a **private window**:

1. `https://josediaztutoring.com/` loads with **no** sign-in (the public site is untouched).
2. `https://josediaztutoring.com/admin` → Google sign-in → sign in as `jadiazlab@gmail.com` → the
   **Resources** list.

### 7.7 If it doesn't work

| What you see | Cause | Fix |
|---|---|---|
| "Forbidden." (plain text) and no Google sign-in | IAP not on for `admin` yet, or still propagating | Check 7.4; wait 5 minutes |
| "Forbidden." after signing in | The admin refused you | `gcloud app logs read --service=admin --project=jalex-hub --limit=20 \| grep "Admin: refused"`, then fix what it says (usually the email in `ADMIN_EMAILS`) |
| Google's "You don't have access" page | 7.5 not done, or done for another account | Run 7.5 for the account you signed in with |
| `Error 400: redirect_uri_mismatch` | Redirect URI missing or mistyped | Redo 7.3 (the Client ID must match the client IAP uses) |
| `Access blocked: … has not completed the Google verification process` | Your account isn't a test user | 7.1 step 2 |
| `/admin` gives the site's 404 page | The public site wasn't redeployed after the `/admin` change | `gcloud app deploy app.yaml --project=jalex-hub` |
| The public site asks for sign-in | IAP was turned on for `default` or the whole app | IAP page: turn those switches off right away |

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
traffic, plus one list read per publish, which is far inside the free tier. The admin scales to zero. IAP is free.
