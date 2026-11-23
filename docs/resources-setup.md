# Resources: one-time setup (project `jalex-hub`)

What this sets up: the private bucket and the Firestore database behind `/resources/`, the
`admin` App Engine service for uploading tools, and Google sign-in (IAP) in front of that service only.
Do the steps in this order. Every command names `--project=jalex-hub`, so it can't land in another project.

Names used below (change them in `app.yaml` and `admin/admin.yaml` too if you pick others):

| Thing | Name |
|---|---|
| Bucket | `gs://josediaz-tutoring-res` (us-east1, private) |
| Firestore database | `(default)`, or `resources` (see step 2) |
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

## 7. Turn on IAP for the `admin` service only

> **Don't run `gcloud iap web enable --resource-type=app-engine`.** It turns IAP on for the whole App
> Engine app, including the public site, and every visitor would get a Google sign-in page. Use the
> console's per-service switch below.

1. **OAuth consent screen** (once per project): Google Cloud console → *Google Auth Platform* →
   *Branding*. App name "Jose Diaz Tutoring admin", your email as support and developer contact.
   *Audience*: External. Leave it in *Testing* and add your Google account under *Test users*.
   Nothing else uses this screen.
2. Console → *Security* → **Identity-Aware Proxy** → *Applications*. Expand **App Engine app**. Turn on
   the switch on the **`admin`** row only. Leave the app-level switch and the `default` row **off**.
   If the console asks for an OAuth client, let it create one.
3. Allow your account through IAP (the same email as in `ADMIN_EMAILS`):

   ```bash
   gcloud iap web add-iam-policy-binding --resource-type=app-engine --service=admin --member=user:YOU@gmail.com --role=roles/iap.httpsResourceAccessor --project=jalex-hub
   ```

4. Open `https://admin-dot-jalex-hub.ue.r.appspot.com`. You sign in with Google and see the list.
5. Check the public site is still open: open `https://josediaztutoring.com/resources/` in a private
   window. No sign-in should appear.

If the admin still answers 403 after you sign in, check the admin's logs. The line `Admin: refused ...`
says why, for example `x@gmail.com is not in ADMIN_EMAILS` or `no IAP header`.

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
