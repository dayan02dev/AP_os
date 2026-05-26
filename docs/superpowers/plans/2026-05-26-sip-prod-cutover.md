# SIP track production cutover — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the SIP track to production from the `staging` branch via a planned ~30-min maintenance-window cutover, preserving every existing TIR submission and adding cross-track submit-lock + multi-track drafting.

**Architecture:** Single API Lambda on prod (`artpark-eir-api-production`) gets new code from a release branch off `staging`. Prod Supabase (`xtmszlpwgbyoumalgbhs`) gets migrations 010-013 + 019 (if missing) + 020 + 021 in a single window. Frontend Vercel deploys a maintenance page during cutover, then the new build. No new AWS Lambdas, no SQS, no AI infrastructure — those land in the next push.

**Tech Stack:** FastAPI + Mangum on AWS Lambda (Python 3.11 arm64), Supabase Postgres + Auth + Storage, Vite/React + react-router on Vercel, AWS SAM for infra, Resend for transactional email.

**Spec reference:** `docs/superpowers/specs/2026-05-26-sip-prod-cutover-design.md` (commit `aa03ff5`).

**Working worktree:** `/Users/apple/Desktop/Final_AP_os/.claude/worktrees/staging-role_based_dashboard`

---

## File structure (what gets changed where)

**Created (new files):**
- `backend/scripts/audit_test_data.sql` — read-only test-row audit query
- `backend/tests/test_cross_track_submit_lock.py` — TDD tests for the new lock

**Modified (existing files on `staging` branch):**
- `backend/app/routers/applications.py` — add cross-track submit-lock check
- `backend/app/routers/sip_applications.py` — add cross-track submit-lock check
- `infra/sam/template.yaml` — revert CORS to single-origin for prod, add API health alarms
- `backend/.env.prod` — bump APP_VERSION, add ALARMS_TOPIC_ARN (gitignored, lives on deploy machine)
- `docs/ARCHITECTURE.md` — post-cutover documentation update

**New maintenance-mode branch (separate from release branch):**
- `frontend/public/maintenance.html` + `frontend/vercel.json` rewrite — static back-at-HH:MM page

**Verification-only files (read but not modified):**
- `frontend/src/App.jsx`, `AppSip.jsx`, `lib/auth.js`, `auth_upload.jsx` — confirm `profiles.track` is updated on chooser pick (if missing, add a small task)
- `backend/migrations/011_sip_track.sql` — confirm RLS posture
- All `backend/migrations/0*.sql` — confirm execution order

---

## Task index

**Phase 1 — Pre-flight & verification (1 day, no prod changes)**
- Task 1: Confirm access (AWS, Vercel, Supabase)
- Task 2: Snapshot prod Supabase (PITR + manual backup tables)
- Task 3: Verify migration 019 drift on prod
- Task 4: Create SNS topic + email subscription
- Task 5: Capture prod auth UUID for ops references

**Phase 2 — Build release branch (1-2 days, code work)**
- Task 6: Create `release/sip-launch-v1` branch off `staging`
- Task 7: Cherry-pick 4 main-only commits
- Task 8: Verify or add frontend `profiles.track` toggle on chooser pick
- Task 9: Add cross-track submit lock — TIR side (TDD)
- Task 10: Add cross-track submit lock — SIP side (TDD)
- Task 11: Revert CORS hack to single-origin in SAM template
- Task 12: Add API health alarms to SAM template
- Task 13: Write `backend/scripts/audit_test_data.sql`
- Task 14: Update `backend/.env.prod` (bump version, add alarms ARN)
- Task 15: Run local test suite + frontend build

**Phase 3 — Maintenance Vercel branch (1 hour)**
- Task 16: Create `maintenance-mode` branch with static page

**Phase 4 — Dry-run on PITR-restored snapshot (half day)**
- Task 17: PITR-restore prod to a fresh Supabase project
- Task 18: Apply migrations 010-021 on snapshot
- Task 19: TIR data preservation check on snapshot
- Task 20: SIP field-coverage E2E test on snapshot
- Task 21: Cross-track submit-lock E2E test on snapshot
- Task 22: Auth flow E2E test on snapshot
- Task 23: Submission email E2E test on snapshot

**Phase 5 — Pre-cutover SAM deploy (additive only, 1 hour)**
- Task 24: Enable termination protection on prod stack
- Task 25: SAM deploy adds alarms to prod
- Task 26: Verify alarms wired to SNS

**Phase 6 — Cutover window (~30 min)**
- Task 27: T-10m team in channel, deploys frozen
- Task 28: T=0 promote maintenance frontend
- Task 29: T+2m test data purge
- Task 30: T+5m apply migrations to prod
- Task 31: T+12m backfill `profiles.track='tir'`
- Task 32: T+13m deploy new Lambda code
- Task 33: T+17m promote real frontend
- Task 34: T+19m smoke test (24 rows)
- Task 35: T+22m CloudWatch sanity
- Task 36: T+25m cutover declared done

**Phase 7 — Post-cutover (48h)**
- Task 37: Stage D verification spot-checks
- Task 38: Resend deliverability check
- Task 39: 48h monitoring
- Task 40: Archive backup tables + update docs

---

## Phase 1 — Pre-flight & verification

### Task 1: Confirm access

**Files:** none

- [ ] **Step 1: Verify AWS access**

Run:
```bash
aws sts get-caller-identity
```
Expected: returns `Arn: arn:aws:iam::348287123004:user/artpark-deploy-admin`.

- [ ] **Step 2: Verify prod CloudFormation stack reachable**

Run:
```bash
aws cloudformation describe-stacks \
  --stack-name artpark-eir-api-production \
  --region ap-south-1 \
  --query 'Stacks[0].StackStatus'
```
Expected: `"UPDATE_COMPLETE"`.

- [ ] **Step 3: Verify Vercel dashboard access**

Open `https://vercel.com/dashboard` in browser. Confirm you can see the AP-OS / apply.artpark.info project and have permission to promote deployments.

- [ ] **Step 4: Verify Supabase prod project access**

Open `https://supabase.com/dashboard/project/xtmszlpwgbyoumalgbhs/sql/new` in browser. Run:
```sql
SELECT now();
```
Expected: returns current timestamp without permission error.

Also verify in Project Settings → API that you can read the `service_role` key (do not copy or share it).

---

### Task 2: Snapshot prod Supabase

**Files:** none (this is a DB operation)

- [ ] **Step 1: Verify PITR is enabled**

Open Supabase dashboard → prod project → Database → Backups. Confirm "Point-in-time recovery" is enabled. If not enabled:
- Enable it
- **STOP HERE for 24 hours** to let PITR accumulate restore points before proceeding. The whole cutover plan depends on PITR as the rollback floor.

- [ ] **Step 2: Take manual logical backup of critical tables**

In prod Supabase SQL editor, run:
```sql
CREATE TABLE applications_backup_2026_05_26    AS SELECT * FROM applications;
CREATE TABLE resume_uploads_backup_2026_05_26  AS SELECT * FROM resume_uploads;
CREATE TABLE profiles_backup_2026_05_26        AS SELECT * FROM profiles;
CREATE TABLE support_tickets_backup_2026_05_26 AS SELECT * FROM support_tickets;
```
Expected: 4 successful CREATE TABLE statements. No errors.

- [ ] **Step 3: Verify row counts match**

```sql
SELECT
  (SELECT count(*) FROM applications)                     AS apps,
  (SELECT count(*) FROM applications_backup_2026_05_26)   AS apps_bkp,
  (SELECT count(*) FROM resume_uploads)                   AS resumes,
  (SELECT count(*) FROM resume_uploads_backup_2026_05_26) AS resumes_bkp,
  (SELECT count(*) FROM profiles)                         AS profiles,
  (SELECT count(*) FROM profiles_backup_2026_05_26)       AS profiles_bkp;
```
Expected: each pair of columns has identical values.

Record the counts (apps / resumes / profiles) for use in Task 30 verification.

---

### Task 3: Verify migration 019 drift on prod

**Files:** none

- [ ] **Step 1: Check whether 019_mandatory_profile_links is already applied**

In prod Supabase SQL editor:
```sql
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='profiles'
  AND column_name IN ('linkedin_url','github_url','resume_url');
```

- [ ] **Step 2: Record the result**

Three cases:
- If all three columns exist AND `is_nullable='NO'` → migration 019 IS applied. Mark Task 30 to **SKIP** the 019 step.
- If columns exist but `is_nullable='YES'` → partial state, possibly a previous abort. Investigate before proceeding (DO NOT auto-apply 019).
- If columns don't exist → 019 is NOT applied. Mark Task 30 to **APPLY** 019_mandatory_profile_links_prod.sql in order.

Write the decision (apply / skip / investigate) at the top of this plan file before continuing.

---

### Task 4: Create SNS topic + email subscription

**Files:** none

- [ ] **Step 1: Create the SNS topic**

```bash
aws sns create-topic --name artpark-prod-alarms --region ap-south-1
```
Capture the `TopicArn` from the output. Should look like: `arn:aws:sns:ap-south-1:348287123004:artpark-prod-alarms`. Save as `$SNS_TOPIC_ARN` in your shell.

- [ ] **Step 2: Subscribe an oncall email**

```bash
aws sns subscribe \
  --topic-arn $SNS_TOPIC_ARN \
  --protocol email \
  --notification-endpoint dev@artpark.in \
  --region ap-south-1
```
Expected: subscription created with `PendingConfirmation` status.

- [ ] **Step 3: Confirm the subscription via email**

Open the inbox for `dev@artpark.in`. Look for an email from AWS with subject "AWS Notification - Subscription Confirmation". Click the confirmation link.

- [ ] **Step 4: Verify subscription is confirmed**

```bash
aws sns list-subscriptions-by-topic --topic-arn $SNS_TOPIC_ARN --region ap-south-1
```
Expected: one subscription with `SubscriptionArn` that is NOT `PendingConfirmation`.

- [ ] **Step 5: Send a test message**

```bash
aws sns publish --topic-arn $SNS_TOPIC_ARN \
  --message "Test from cutover prep $(date)" \
  --subject "test: artpark-prod-alarms" \
  --region ap-south-1
```
Verify email arrives at `dev@artpark.in`.

---

### Task 5: Capture prod auth UUID for ops references

**Files:** none

- [ ] **Step 1: Look up your auth.users UUID in prod**

In prod Supabase SQL editor:
```sql
SELECT id, email, created_at
FROM auth.users
WHERE email = 'dev@artpark.in';
```

- [ ] **Step 2: Save the UUID**

Note: this UUID is used in Stage D verification (signing in as a known account) but NOT used to grant any role during this push. No `user_roles` table exists yet on prod — leadership push handles that. The UUID is recorded for the implementation plan in case you sign in as a test applicant.

---

## Phase 2 — Build release branch

### Task 6: Create `release/sip-launch-v1` branch

**Files:** branch operation

- [ ] **Step 1: Ensure we have origin/staging up to date**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/staging-role_based_dashboard
git fetch origin staging
git log --oneline origin/staging -3
```
Confirm the most recent commit on origin/staging is the expected one.

- [ ] **Step 2: Create the release branch off origin/staging tip**

```bash
git worktree add /Users/apple/Desktop/Final_AP_os/.claude/worktrees/release-sip-launch-v1 -b release/sip-launch-v1 origin/staging
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/release-sip-launch-v1
git status
```
Expected: clean working tree on branch `release/sip-launch-v1`, HEAD points at origin/staging tip.

- [ ] **Step 3: Verify migrations on this branch**

```bash
ls backend/migrations/
```
Expected: includes `010_track_rename_and_split.sql` through `021_sip_team_and_dpiit.sql` (plus 019 variants). Confirms we're on the right base.

---

### Task 7: Cherry-pick 4 main-only commits

**Files:** likely conflicts in `frontend/src/App.jsx`, `frontend/public/programs.html`, others

- [ ] **Step 1: Re-verify the 4 SHAs are not on this branch**

```bash
for sha in 28842fc a118078 2d9cc68 888a2b0; do
  if git merge-base --is-ancestor $sha HEAD 2>/dev/null; then
    echo "$sha — already on branch, SKIP"
  else
    echo "$sha — NOT on branch, will cherry-pick"
  fi
done
```

- [ ] **Step 2: Cherry-pick autosave fix**

```bash
git cherry-pick 28842fc
```
Expected: applies cleanly OR reports conflict. If conflict:
- Open the conflicting file
- Look for `<<<<<<<` markers
- Resolve in favor of the cherry-picked change (autosave-on-signout is a small surgical fix)
- `git add <file>` then `git cherry-pick --continue`

- [ ] **Step 3: Cherry-pick draft-fallback guard**

```bash
git cherry-pick a118078
```
Same conflict-resolution pattern if needed.

- [ ] **Step 4: Cherry-pick SIP countdown bump**

```bash
git cherry-pick 2d9cc68
```

- [ ] **Step 5: Cherry-pick TIR deadline bump**

```bash
git cherry-pick 888a2b0
```

- [ ] **Step 6: Verify the 4 commits are on top**

```bash
git log --oneline -10
```
Expected: top 4 commits are the 4 cherry-picks (with their original messages).

---

### Task 8: Verify or add frontend `profiles.track` toggle on chooser pick

**Files to inspect:** `frontend/src/App.jsx`, `frontend/src/lib/auth.js`, `frontend/src/auth_upload.jsx`, `frontend/src/AppSip.jsx`

- [ ] **Step 1: Search for existing track-update logic**

```bash
grep -rn "track\s*=\|setTrack\|PATCH.*profile\|updateTrack" frontend/src/ \
  --include='*.js' --include='*.jsx' | head -30
```
Read each match. Determine whether the frontend currently calls a backend endpoint (e.g., `PATCH /profile` or similar) when a user clicks TIR or SIP at the chooser.

- [ ] **Step 2: Decision branch**

Three outcomes:
- **A. Already implemented and toggles on every chooser pick:** mark this task COMPLETE, move on.
- **B. Implemented but only set once at signup:** add the toggle in Step 3.
- **C. Not implemented at all:** add the toggle in Step 3.

- [ ] **Step 3 (if B or C): Add the track toggle**

The chooser handler in `frontend/src/App.jsx` (or wherever `/apply` renders TIR/SIP buttons) must call a backend endpoint to update `profiles.track` before navigating into the wizard. Pseudocode:

```jsx
const handlePickTrack = async (track) => {
  await api.patch('/auth/me/track', { track });   // backend writes profiles.track
  navigate(`/apply/${track}/basic`);
};
```

Backend endpoint to add (in `backend/app/routers/auth.py`):

```python
@router.patch("/auth/me/track")
async def set_my_track(
    body: TrackUpdate,
    current_user: dict = Depends(get_current_user),
):
    supa = get_admin_client()
    supa.table('profiles').update({'track': body.track}).eq('id', current_user['user_id']).execute()
    return {'ok': True, 'track': body.track}
```

With matching Pydantic model `TrackUpdate(BaseModel): track: Literal['tir','sip']`.

- [ ] **Step 4: Write test for the new endpoint**

Create `backend/tests/test_auth_track.py`:

```python
def test_set_my_track_to_sip(client, signed_in_user):
    response = client.patch(
        "/auth/me/track",
        json={"track": "sip"},
        headers={"Authorization": f"Bearer {signed_in_user['token']}"}
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True, "track": "sip"}

def test_set_my_track_invalid(client, signed_in_user):
    response = client.patch(
        "/auth/me/track",
        json={"track": "invalid"},
        headers={"Authorization": f"Bearer {signed_in_user['token']}"}
    )
    assert response.status_code == 422
```

- [ ] **Step 5: Run tests**

```bash
cd backend && python -m pytest tests/test_auth_track.py -v
```
Expected: 2 passing.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/auth.py backend/app/models/auth.py backend/tests/test_auth_track.py frontend/src/App.jsx
git commit -m "feat(track): toggle profiles.track on chooser pick"
```

---

### Task 9: Add cross-track submit lock — TIR side (TDD)

**Files:**
- Modify: `backend/app/routers/applications.py` (submit handler)
- Create: `backend/tests/test_cross_track_submit_lock.py`

- [ ] **Step 1: Write failing test for TIR submit when SIP already submitted**

Create `backend/tests/test_cross_track_submit_lock.py`:

```python
import pytest
from fastapi.testclient import TestClient

def test_tir_submit_blocked_when_sip_submitted(client, supabase, signed_in_user):
    """A user who already submitted a SIP application cannot submit a TIR application."""
    user_id = signed_in_user['user_id']

    # Insert a submitted SIP application directly (bypass submit handler)
    supabase.table('sip_applications').insert({
        'user_id': user_id,
        'status': 'submitted',
        'submitted_at': 'now()',
        # ... minimal required fields
    }).execute()

    # Create a TIR draft for this user
    client.get('/applications/me', headers={"Authorization": f"Bearer {signed_in_user['token']}"})
    # ... patch it with required fields ...

    # Attempt TIR submit
    response = client.post(
        '/applications/me/submit',
        headers={"Authorization": f"Bearer {signed_in_user['token']}"}
    )

    assert response.status_code == 409
    body = response.json()
    assert body['error']['code'] == 'cross_track_submission_blocked'
    assert 'SIP' in body['error']['message']

def test_tir_submit_succeeds_when_no_sip_submitted(client, supabase, signed_in_user):
    """A user who has not submitted any SIP can submit TIR normally."""
    # Create a TIR draft, fill required fields, submit — should succeed
    # ... test body ...
    response = client.post(
        '/applications/me/submit',
        headers={"Authorization": f"Bearer {signed_in_user['token']}"}
    )
    assert response.status_code == 200
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/test_cross_track_submit_lock.py::test_tir_submit_blocked_when_sip_submitted -v
```
Expected: FAIL (returns 200 instead of 409, because the check doesn't exist yet).

- [ ] **Step 3: Add the check to the TIR submit handler**

In `backend/app/routers/applications.py`, find the `submit_application` function. Add this check BEFORE any other validation logic, just after `get_current_user`:

```python
# Cross-track submit lock: a user can submit to only ONE track ever.
# If they have any non-draft row in sip_applications, block this submit.
sip_submitted = supa_admin.table('sip_applications') \
    .select('id', count='exact', head=True) \
    .eq('user_id', user_id) \
    .neq('status', 'draft') \
    .execute()
if (sip_submitted.count or 0) > 0:
    raise HTTPException(
        status_code=409,
        detail={
            'error': {
                'code': 'cross_track_submission_blocked',
                'message': 'You have already submitted a SIP application. You cannot also submit a TIR application.'
            }
        }
    )
```

(Adjust the variable name `supa_admin` to whatever the file uses.)

- [ ] **Step 4: Run tests, verify pass**

```bash
cd backend && python -m pytest tests/test_cross_track_submit_lock.py -v
```
Expected: 2 passing.

- [ ] **Step 5: Run the full applications test file to ensure no regression**

```bash
cd backend && python -m pytest tests/test_applications.py -v
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/applications.py backend/tests/test_cross_track_submit_lock.py
git commit -m "feat(track): block TIR submit when SIP already submitted"
```

---

### Task 10: Add cross-track submit lock — SIP side (TDD)

**Files:**
- Modify: `backend/app/routers/sip_applications.py` (submit handler)
- Modify: `backend/tests/test_cross_track_submit_lock.py` (add SIP test cases)

- [ ] **Step 1: Add failing test for SIP submit when TIR already submitted**

Append to `backend/tests/test_cross_track_submit_lock.py`:

```python
def test_sip_submit_blocked_when_tir_submitted(client, supabase, signed_in_user):
    """A user who already submitted a TIR application cannot submit a SIP application."""
    user_id = signed_in_user['user_id']

    # Insert a submitted TIR application directly
    supabase.table('tir_applications').insert({
        'user_id': user_id,
        'status': 'submitted',
        'submitted_at': 'now()',
        # ... minimal required fields
    }).execute()

    # Create a SIP draft for this user
    client.get('/sip/applications/me', headers={"Authorization": f"Bearer {signed_in_user['token']}"})
    # ... patch it with required SIP fields ...

    # Attempt SIP submit
    response = client.post(
        '/sip/applications/me/submit',
        headers={"Authorization": f"Bearer {signed_in_user['token']}"}
    )

    assert response.status_code == 409
    body = response.json()
    assert body['error']['code'] == 'cross_track_submission_blocked'
    assert 'TIR' in body['error']['message']

def test_sip_submit_succeeds_when_no_tir_submitted(client, supabase, signed_in_user):
    """A user with no TIR submissions can submit SIP normally."""
    response = client.post(
        '/sip/applications/me/submit',
        headers={"Authorization": f"Bearer {signed_in_user['token']}"}
    )
    assert response.status_code == 200
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/test_cross_track_submit_lock.py::test_sip_submit_blocked_when_tir_submitted -v
```
Expected: FAIL with 200 instead of 409.

- [ ] **Step 3: Add the check to the SIP submit handler**

In `backend/app/routers/sip_applications.py`, find the SIP submit function (around line 400-700 based on the helper at line 253). Add the symmetric check:

```python
# Cross-track submit lock: mirror of applications.py
tir_submitted = supa_admin.table('tir_applications') \
    .select('id', count='exact', head=True) \
    .eq('user_id', user_id) \
    .neq('status', 'draft') \
    .execute()
if (tir_submitted.count or 0) > 0:
    raise HTTPException(
        status_code=409,
        detail={
            'error': {
                'code': 'cross_track_submission_blocked',
                'message': 'You have already submitted a TIR application. You cannot also submit a SIP application.'
            }
        }
    )
```

- [ ] **Step 4: Run all 4 cross-track tests, verify pass**

```bash
cd backend && python -m pytest tests/test_cross_track_submit_lock.py -v
```
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/sip_applications.py backend/tests/test_cross_track_submit_lock.py
git commit -m "feat(track): block SIP submit when TIR already submitted"
```

---

### Task 11: Revert CORS hack to single-origin in SAM template

**Files:** `infra/sam/template.yaml`

- [ ] **Step 1: Open template.yaml and find the CORS block**

Search for `AllowOrigins`:
```bash
grep -nA5 "AllowOrigins" infra/sam/template.yaml
```

- [ ] **Step 2: Replace the hardcoded staging URL list with prod single-origin**

Find the block like:
```yaml
AllowOrigins:
  - "https://ap-os-git-staging-artpark.vercel.app"
  - "https://ap-os-git-staging-rolebaseddashboard-artpark.vercel.app"
```

Replace with:
```yaml
AllowOrigins:
  - "https://apply.artpark.info"
```

Keep the existing comment explaining the SAM-transform issue — it's still relevant and documents WHY we hardcode rather than use `!Split`.

- [ ] **Step 3: Verify FrontendOrigin env var alignment**

Confirm `FrontendOrigin` parameter default is `https://apply.artpark.info` (it'll be overridden by `.env.prod` at deploy time anyway).

- [ ] **Step 4: Commit**

```bash
git add infra/sam/template.yaml
git commit -m "fix(sam): hardcode single-origin CORS for prod"
```

---

### Task 12: Add API health alarms to SAM template

**Files:** `infra/sam/template.yaml`

- [ ] **Step 1: Add the AlarmsTopic parameter**

Near the top of `Parameters:`, add:

```yaml
  AlarmsTopic:
    Type: String
    Description: SNS topic ARN for prod alarm notifications
    Default: "arn:aws:sns:ap-south-1:348287123004:artpark-prod-alarms"
```

- [ ] **Step 2: Add 3 alarm resources at the bottom of `Resources:`**

```yaml
  ApiErrorsAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "artpark-eir-api-${EnvName}-errors"
      AlarmDescription: "API Lambda Errors > 0 in any 5-min window"
      Namespace: AWS/Lambda
      MetricName: Errors
      Dimensions:
        - Name: FunctionName
          Value: !Ref ApiFunction
      Statistic: Sum
      Period: 300
      EvaluationPeriods: 1
      Threshold: 0
      ComparisonOperator: GreaterThanThreshold
      TreatMissingData: notBreaching
      AlarmActions:
        - !Ref AlarmsTopic
      OKActions:
        - !Ref AlarmsTopic

  ApiThrottlesAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "artpark-eir-api-${EnvName}-throttles"
      AlarmDescription: "API Lambda Throttles > 0"
      Namespace: AWS/Lambda
      MetricName: Throttles
      Dimensions:
        - Name: FunctionName
          Value: !Ref ApiFunction
      Statistic: Sum
      Period: 300
      EvaluationPeriods: 1
      Threshold: 0
      ComparisonOperator: GreaterThanThreshold
      TreatMissingData: notBreaching
      AlarmActions:
        - !Ref AlarmsTopic

  ApiP99DurationAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "artpark-eir-api-${EnvName}-p99-duration"
      AlarmDescription: "API Lambda Duration p99 > 25000 ms"
      Namespace: AWS/Lambda
      MetricName: Duration
      Dimensions:
        - Name: FunctionName
          Value: !Ref ApiFunction
      ExtendedStatistic: p99
      Period: 300
      EvaluationPeriods: 1
      Threshold: 25000
      ComparisonOperator: GreaterThanThreshold
      TreatMissingData: notBreaching
      AlarmActions:
        - !Ref AlarmsTopic
```

- [ ] **Step 3: Validate SAM template syntax**

```bash
cd infra/sam
sam validate --region ap-south-1
```
Expected: "is a valid SAM Template" with no errors.

- [ ] **Step 4: Commit**

```bash
git add infra/sam/template.yaml
git commit -m "feat(sam): add API health alarms (Errors/Throttles/p99 Duration)"
```

---

### Task 13: Write `backend/scripts/audit_test_data.sql`

**Files:** create `backend/scripts/audit_test_data.sql`

- [ ] **Step 1: Create the audit query file**

```sql
-- audit_test_data.sql — read-only test-row audit for prod pre-cutover.
--
-- Identifies applications whose owner email looks like test data, so a human
-- operator can decide which (if any) rows to DELETE before the cutover
-- migrations apply. Do NOT DELETE based on this output blindly.
--
-- Run pre-cutover against the OLD `applications` table.
-- After migration 010, the same query applies to `tir_applications`.

SELECT
  a.id,
  a.user_id,
  p.email,
  a.status,
  a.submitted_at,
  a.created_at,
  a.updated_at
FROM applications a
JOIN profiles p ON p.id = a.user_id
WHERE p.email ILIKE '%@artpark.test'
   OR p.email ILIKE '%@example.%'
   OR p.email ILIKE '%+test%@%'
   OR p.email ILIKE 'test%@%'
   OR p.email ILIKE 'demo%@%'
ORDER BY a.created_at DESC;
```

- [ ] **Step 2: Test the query against staging Supabase**

Open the staging Supabase SQL editor (project `exqmxvdtcsvpgtftwjml`), paste the query, run. Verify it returns a reasonable list (likely the seed-staging rows from `seed_staging.py`).

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/audit_test_data.sql
git commit -m "feat(scripts): add audit_test_data.sql for pre-cutover review"
```

---

### Task 14: Update `backend/.env.prod`

**Files:** `backend/.env.prod` (gitignored, NOT committed to git)

- [ ] **Step 1: Open the file on the deploy machine**

```bash
# backend/.env.prod lives outside git; on the deploy machine, edit it
$EDITOR backend/.env.prod
```

- [ ] **Step 2: Bump APP_VERSION**

Change:
```
APP_VERSION=0.1.0
```
To:
```
APP_VERSION=0.9.0-sip
```

- [ ] **Step 3: Add ALARMS_TOPIC_ARN**

Append:
```
ALARMS_TOPIC_ARN=arn:aws:sns:ap-south-1:348287123004:artpark-prod-alarms
```

- [ ] **Step 4: Save and verify**

```bash
cat backend/.env.prod | grep -E 'APP_VERSION|ALARMS_TOPIC_ARN'
```
Expected: shows the new values.

- [ ] **Step 5: No commit (gitignored)**

This file is not in git. Just confirm it's on the deploy machine.

---

### Task 15: Run local test suite + frontend build

**Files:** none directly

- [ ] **Step 1: Backend tests**

```bash
cd backend && python -m pytest -x -q
```
Expected: all green. If any tests fail, fix before proceeding.

- [ ] **Step 2: Frontend tests**

```bash
cd ../frontend && npm install && npm run test
```
Expected: all green.

- [ ] **Step 3: Frontend build**

```bash
npm run build
```
Expected: build succeeds, `dist/` directory produced. No warnings about missing env vars (those are pulled at deploy time on Vercel).

---

## Phase 3 — Maintenance Vercel branch

### Task 16: Create `maintenance-mode` branch with static page

**Files:**
- Create: `frontend/public/maintenance.html`
- Modify: `frontend/vercel.json`

Note: do this on a SEPARATE branch off `main` (not `release/sip-launch-v1`).

- [ ] **Step 1: Create the maintenance branch off main**

```bash
git worktree add /Users/apple/Desktop/Final_AP_os/.claude/worktrees/maintenance-mode -b maintenance-mode origin/main
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/maintenance-mode
```

- [ ] **Step 2: Create `frontend/public/maintenance.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Scheduled maintenance — ARTPARK</title>
  <style>
    body { font-family: 'Open Sans', system-ui, sans-serif; background: #FFFFF7; color: #1A1A1A; margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card { max-width: 480px; text-align: left; }
    .eyebrow { text-transform: uppercase; letter-spacing: 0.14em; font-size: 12px; color: #6B6B6B; margin: 0 0 8px; }
    h1 { font-family: 'Trebuchet MS', 'Lucida Grande', sans-serif; font-size: 36px; font-weight: 700; line-height: 1.1; margin: 0 0 16px; }
    p { font-size: 16px; line-height: 1.5; margin: 0 0 12px; }
    a { color: #5B2EFF; }
  </style>
</head>
<body>
  <div class="card">
    <p class="eyebrow">ARTPARK</p>
    <h1>Scheduled maintenance.</h1>
    <p>We're rolling out an update to the application portal. We'll be back shortly.</p>
    <p>Questions? Email <a href="mailto:support@artpark.in">support@artpark.in</a>.</p>
  </div>
</body>
</html>
```

- [ ] **Step 3: Update `frontend/vercel.json` to redirect everything to maintenance.html**

Replace the entire `rewrites` array with:

```json
"rewrites": [
  { "source": "/(.*)", "destination": "/maintenance.html" }
]
```

Keep all other config (headers, etc.) intact.

- [ ] **Step 4: Commit**

```bash
git add frontend/public/maintenance.html frontend/vercel.json
git commit -m "feat(maintenance): static maintenance-mode page for cutover windows"
git push -u origin maintenance-mode
```

- [ ] **Step 5: Wait for Vercel to build the maintenance-mode deployment**

Open the Vercel dashboard. Find the `maintenance-mode` branch deployment. Wait until status is "Ready". Open the deployment URL in incognito to verify the maintenance page renders. **Do NOT promote to production yet.**

---

## Phase 4 — Dry-run on PITR-restored snapshot

### Task 17: PITR-restore prod to a fresh Supabase project

**Files:** none

- [ ] **Step 1: In Supabase dashboard, open prod project → Database → Backups**

- [ ] **Step 2: Click "Restore to point in time"**

Choose a timestamp ~5 minutes in the past. Restore destination: create a NEW Supabase project (e.g., `artpark-eir-prod-dryrun-2026-05-26`). Wait for restore to complete (~30-60 min).

- [ ] **Step 3: Capture restored project credentials**

In the new project's Settings → API, note:
- Project URL (e.g., `https://abcdefgh.supabase.co`)
- anon key
- service_role key

Save these to a temporary `.env.dryrun` file on your deploy machine. Do NOT commit.

- [ ] **Step 4: Verify the restored DB has the expected data**

In the new project's SQL editor:
```sql
SELECT count(*) FROM applications;
SELECT count(*) FROM profiles;
SELECT count(*) FROM resume_uploads;
```
Expected: counts match prod minus 5 min of activity.

---

### Task 18: Apply migrations 010-021 on snapshot

**Files:** migration files in `backend/migrations/` on release branch

- [ ] **Step 1: Open the restored Supabase project's SQL editor**

- [ ] **Step 2: Apply migration 010**

In another terminal:
```bash
cat backend/migrations/010_track_rename_and_split.sql
```
Copy the contents, paste into SQL editor, click RUN. Wait for green.

- [ ] **Step 3: Verify migration 010 succeeded**

```sql
SELECT count(*) FROM tir_applications;
SELECT count(*) FROM applications;   -- expect: relation does not exist
SELECT id FROM storage.buckets WHERE id LIKE 'tir-%';
```

- [ ] **Step 4: Apply migrations 011, 012, 013 in order**

Repeat the paste-and-run for each. Verify each succeeds before moving on.

- [ ] **Step 5: Apply migration 019 (only if Task 3 said APPLY)**

If Task 3 determined 019 is not yet applied to prod, apply `019_mandatory_profile_links_prod.sql` here.

**Do NOT apply** `019_mandatory_profile_links_staging.sql` against prod.

- [ ] **Step 6: Apply migration 020 and 021**

```sql
-- paste 020_sip_application_templates.sql, run
-- paste 021_sip_team_and_dpiit.sql, run
```

- [ ] **Step 7: Backfill profiles.track**

```sql
BEGIN;
UPDATE profiles SET track='tir' WHERE track IS NULL;
SELECT count(*) FROM profiles WHERE track IS NULL;   -- expect 0
COMMIT;
```

- [ ] **Step 8: Confirm all expected schema is present**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('tir_applications','sip_applications',
                     'tir_resume_uploads','sip_resume_uploads',
                     'application_templates','sip_application_templates');
-- expect 6 rows
```

---

### Task 19: TIR data preservation check on snapshot

**Files:** none

- [ ] **Step 1: Compare row counts to pre-migration**

```sql
SELECT count(*) FROM tir_applications;
-- compare to the count you noted in Task 2 Step 3 (applications backup count)
```

- [ ] **Step 2: Spot-check 5 random TIR submitted apps**

```sql
SELECT id, user_id, basic_full_name, status, submitted_at
FROM tir_applications
WHERE status != 'draft'
ORDER BY random()
LIMIT 5;
```

For each row, verify:
- `submitted_at` is preserved (not NULL)
- `basic_full_name` is reasonable
- Get the user_id, then:

```sql
SELECT storage_path FROM tir_resume_uploads WHERE user_id='<uid>' LIMIT 1;
```

- [ ] **Step 3: Verify a sample evidence file is still reachable in storage**

In the restored Supabase dashboard → Storage → bucket `tir-evidence-files`, navigate to one of the paths returned above. Confirm the file is downloadable.

- [ ] **Step 4: Mark Task 19 pass/fail**

If any check fails (missing data, broken storage path), STOP and investigate before proceeding to live cutover.

---

### Task 20: SIP field-coverage E2E test on snapshot

**Files:** none (operational test)

- [ ] **Step 1: Configure backend to point at the restored project**

```bash
# On the deploy machine:
cp backend/.env.prod backend/.env.dryrun
$EDITOR backend/.env.dryrun
```

Update `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` to the dryrun project values. Keep everything else identical.

- [ ] **Step 2: Run backend locally against the restored project**

```bash
cd backend
ENV_FILE=.env.dryrun uvicorn app.main:app --reload --port 8000
```

Verify health: `curl http://localhost:8000/health` returns 200.

- [ ] **Step 3: Run frontend locally pointing at this backend**

```bash
cd ../frontend
VITE_API_BASE_URL=http://localhost:8000 npm run dev
```

Open `http://localhost:5173` in a fresh browser.

- [ ] **Step 4: Sign up as a new test user, pick SIP**

Use a unique test email like `sip-dryrun-$(date +%s)@example.com`. Complete OTP (or use dev_get_otp.py to bypass SMTP). Set password. Land on `/apply` → see chooser.

- [ ] **Step 5: Fill the SIP wizard end-to-end**

Click SIP. Fill every question across all sections:
- Basic: full_name, phone, email, org, degree, has_team, teammates, dpiit
- Problem: describe + defined
- Solution: describe, core_tech, contrarian_insight, stage
- Execution: will_break, milestone, infrastructure, failure, hwsw, milestone_files (upload 1+)
- Evidence: pitch_deck (upload), cap_table (upload), traction (upload + details), demo_video URL, patents (upload 1+)
- Declaration: all 4 checkboxes

Save draft, then submit.

- [ ] **Step 6: Verify every column has a value**

In the restored SQL editor:
```sql
SELECT * FROM sip_applications WHERE basic_email='<test-email>';
```
Walk every column. Confirm:
- Every wizard answer landed in the right column
- File-list JSONB columns (`sip_traction_files`, `sip_patents_files`, etc.) have entries
- `sip_pitch_deck`, `sip_cap_table_file`, `sip_demo_video_url` are populated
- `sip_team_size` / DPIIT fields populated (from migration 021)

- [ ] **Step 7: Verify storage objects exist**

For each file-bearing column, look up its storage_path. Open Supabase Storage → corresponding bucket → confirm the object is present.

- [ ] **Step 8: If ANY field is missing or NULL where the wizard provided a value**

STOP. Investigate which migration / router code path missed it. Fix in `release/sip-launch-v1`, commit, re-run from Step 4.

---

### Task 21: Cross-track submit-lock E2E test on snapshot

**Files:** none (operational test)

- [ ] **Step 1: Sign up a fresh test user, draft BOTH tracks**

New email. Pick TIR → fill a few answers → save → back to chooser → pick SIP → fill a few answers → save.

- [ ] **Step 2: Verify both drafts coexist**

```sql
SELECT 'tir' AS track, id, status FROM tir_applications WHERE user_id='<uid>'
UNION ALL
SELECT 'sip' AS track, id, status FROM sip_applications WHERE user_id='<uid>';
```
Expected: 2 rows, both `status='draft'`.

- [ ] **Step 3: Submit TIR first**

Navigate back to TIR draft, fill required fields, submit. Expected: success (200).

- [ ] **Step 4: Try to submit SIP — should be blocked**

Navigate to SIP draft, click submit. Expected: 409 error with code `cross_track_submission_blocked`.

In the SQL editor:
```sql
SELECT status FROM sip_applications WHERE user_id='<uid>';
```
Expected: still `'draft'`.

- [ ] **Step 5: Reverse case — another fresh user, submit SIP first**

Another fresh email. Draft both. Submit SIP first → 200. Try TIR submit → 409 `cross_track_submission_blocked`.

- [ ] **Step 6: Existing TIR applicant case**

Sign in as a known prod TIR applicant whose data was preserved through migration 010 (look one up from Task 19). On `/apply`, the chooser should appear. Pick SIP. Fill a SIP draft. Try to submit SIP → 409 (because their existing TIR submission activates the lock).

---

### Task 22: Auth flow E2E test on snapshot

**Files:** none

- [ ] **Step 1: Sign-up via OTP**

Fresh email at `/apply/signup`. Receive OTP. Verify. Set password. Reach `/apply` with chooser visible.

- [ ] **Step 2: Sign out, sign back in via password**

`/apply/signin`, enter email + password. Land on `/apply`.

- [ ] **Step 3: Sign out, sign back in via OTP fallback**

`/apply/signin`, click "Email me a code", enter OTP. Land on `/apply`.

- [ ] **Step 4: Verify /auth/me + rehydration**

After signin, refresh the browser. The user should still be signed in (no re-prompt). `useAuth` rehydrates from localStorage.

---

### Task 23: Submission email E2E test on snapshot

**Files:** none

- [ ] **Step 1: Set RESEND_API_KEY in .env.dryrun to a real Resend key**

Either:
- Use the prod Resend key (no harm in sending real emails to test inboxes during dry-run)
- Or create a Resend "dev mode" key that only sends to verified inboxes

- [ ] **Step 2: Submit a TIR application (test user 1)**

Complete a TIR submit on the local frontend → backend → restored DB.

- [ ] **Step 3: Verify email arrives**

Check the test user's inbox. Expected: "ARTPARK TIR application received" or similar template content. Should arrive within 30s.

- [ ] **Step 4: Submit a SIP application (test user 2)**

Same as above but on the SIP wizard.

- [ ] **Step 5: Verify SIP email arrives**

Check that test user's inbox. Expected: similar confirmation email referencing the SIP submission. Body should be track-agnostic but include the applicant's name + app id.

- [ ] **Step 6: Verify Resend dashboard shows successful deliveries**

Open Resend dashboard. Confirm both submissions appear with status `delivered` (or `sent`/`200`). No bounces.

---

## Phase 5 — Pre-cutover SAM deploy

### Task 24: Enable termination protection on prod stack

**Files:** none

- [ ] **Step 1: Enable termination protection**

```bash
aws cloudformation update-termination-protection \
  --enable-termination-protection \
  --stack-name artpark-eir-api-production \
  --region ap-south-1
```
Expected: returns `{ "StackId": "..." }`.

- [ ] **Step 2: Verify**

```bash
aws cloudformation describe-stacks \
  --stack-name artpark-eir-api-production \
  --region ap-south-1 \
  --query 'Stacks[0].EnableTerminationProtection'
```
Expected: `true`.

---

### Task 25: SAM deploy adds alarms to prod (additive)

**Files:** none (deploys infra)

- [ ] **Step 1: From the release branch worktree, verify branch state**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/release-sip-launch-v1
git status   # must show release/sip-launch-v1, clean
git log --oneline -10
```

- [ ] **Step 2: Confirm backend/.env.prod is in place**

```bash
ls -la backend/.env.prod
grep -E 'APP_VERSION|ALARMS_TOPIC_ARN|FRONTEND_ORIGIN' backend/.env.prod
```
Expected: file exists, `APP_VERSION=0.9.0-sip`, `ALARMS_TOPIC_ARN` set, `FRONTEND_ORIGIN=https://apply.artpark.info`.

- [ ] **Step 3: Run SAM deploy**

```bash
cd infra/sam
./deploy-prod.sh
```
Expected: SAM build succeeds (Docker may take 2-3 min cold), then deploy succeeds. CloudFormation shows new resources: `ApiErrorsAlarm`, `ApiThrottlesAlarm`, `ApiP99DurationAlarm`.

⚠️ **This step also updates the Lambda code** with the cross-track submit lock changes from Tasks 9 & 10. That's intentional: those changes are backward-compatible (no migrations applied yet, so the cross-track check returns 0 every time, no behavior change for users).

- [ ] **Step 4: Verify deployment succeeded**

```bash
aws cloudformation describe-stacks \
  --stack-name artpark-eir-api-production \
  --region ap-south-1 \
  --query 'Stacks[0].StackStatus'
```
Expected: `UPDATE_COMPLETE`.

```bash
curl -s https://api.artpark.info/health | jq
```
Expected: `version: "0.9.0-sip"`, `status: "ok"`.

---

### Task 26: Verify alarms wired to SNS

**Files:** none

- [ ] **Step 1: List the new alarms**

```bash
aws cloudwatch describe-alarms --region ap-south-1 \
  --alarm-name-prefix artpark-eir-api-production \
  --query 'MetricAlarms[].[AlarmName,StateValue,AlarmActions]' \
  --output table
```
Expected: 3 alarms (errors, throttles, p99-duration), each with `AlarmActions` pointing at the SNS topic ARN.

- [ ] **Step 2: Trigger a test by manually setting alarm state**

```bash
aws cloudwatch set-alarm-state --region ap-south-1 \
  --alarm-name artpark-eir-api-production-errors \
  --state-value ALARM --state-reason "Cutover-prep manual test"
```
Expected: an email arrives at `dev@artpark.in` within 1-2 min from the SNS topic.

- [ ] **Step 3: Reset the alarm state**

```bash
aws cloudwatch set-alarm-state --region ap-south-1 \
  --alarm-name artpark-eir-api-production-errors \
  --state-value OK --state-reason "Reset after test"
```

---

## Phase 6 — Cutover window

⚠️ All Stage C tasks happen sequentially in a single window. Do not pause between them.

### Task 27: T-10m team in channel

**Files:** none

- [ ] **Step 1: Announce in Slack/cutover channel**

"Cutover starting in 10 minutes. All deploys frozen until I declare 'done'."

- [ ] **Step 2: Open required tabs**

- Vercel dashboard (Deployments page for both `maintenance-mode` and `release/sip-launch-v1` builds)
- Supabase prod SQL editor
- AWS CloudWatch logs page for `/aws/lambda/artpark-eir-api-production`
- Sentry dashboard for the prod project
- Terminal with the release branch worktree active

- [ ] **Step 3: Cutover lead confirms readiness**

Verify with team: backups in place (Task 2), dry-run passed (Tasks 19-23), termination protection on (Task 24), alarms green (Task 26).

---

### Task 28: T=0 — Promote maintenance frontend

**Files:** none

- [ ] **Step 1: In Vercel dashboard, find the `maintenance-mode` deployment**

- [ ] **Step 2: Click "Promote to Production"**

- [ ] **Step 3: Wait for promotion to complete (~30 sec)**

- [ ] **Step 4: Verify in incognito browser**

Open `https://apply.artpark.info` in a fresh incognito tab. Expected: maintenance page renders.

---

### Task 29: T+2m — Test data purge

**Files:** none

- [ ] **Step 1: Run the audit query**

In prod Supabase SQL editor, paste contents of `backend/scripts/audit_test_data.sql` and run.

- [ ] **Step 2: Review the list**

Eyeball each row. Confirm they are all test data (NOT real applicants). If anything looks suspicious (e.g., a real-looking email matching a test pattern), exclude it from the purge.

- [ ] **Step 3: Compose and run the DELETE inside a transaction**

```sql
BEGIN;
-- List the IDs to delete based on the audit
DELETE FROM applications WHERE id IN ('<id1>','<id2>', ...);
DELETE FROM resume_uploads WHERE user_id IN ('<uid1>','<uid2>', ...);
DELETE FROM profiles WHERE id IN ('<uid1>','<uid2>', ...);

-- Verify counts before commit
SELECT count(*) FROM applications;
SELECT count(*) FROM profiles;

COMMIT;
```
Expected: counts are sensible (reduced by the number of test rows purged).

---

### Task 30: T+5m — Apply migrations to prod

**Files:** migration SQL files

- [ ] **Step 1: Apply 010_track_rename_and_split.sql**

Paste and run.

Verify:
```sql
SELECT count(*) FROM tir_applications;       -- pre-cutover apps count minus purged
SELECT count(*) FROM applications;            -- ERROR: relation does not exist
SELECT id FROM storage.buckets WHERE id LIKE 'tir-%';   -- 3 rows
```

- [ ] **Step 2: Apply 011_sip_track.sql**

Paste and run.

Verify:
```sql
SELECT count(*) FROM sip_applications;        -- 0
SELECT id FROM storage.buckets WHERE id LIKE 'sip-%';   -- 3 rows
```

- [ ] **Step 3: Apply 012_sip_add_will_break.sql**

Paste and run.

- [ ] **Step 4: Apply 013_relax_other_constraints.sql**

Paste and run.

- [ ] **Step 5: Apply 019_mandatory_profile_links_prod.sql (ONLY if Task 3 said APPLY)**

If Task 3 determined this is needed, paste and run. **Do NOT run** `019_mandatory_profile_links_staging.sql`.

- [ ] **Step 6: Apply 020_sip_application_templates.sql**

Paste and run.

Verify:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name='sip_application_templates';
-- expect 1 row
```

- [ ] **Step 7: Apply 021_sip_team_and_dpiit.sql**

Paste and run.

Verify:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='sip_applications'
  AND column_name IN ('basic_has_team','basic_teammates',
                      'basic_dpiit_registered',
                      'basic_dpiit_recognition_number',
                      'basic_dpiit_recognition_date');
-- expect 5 rows
```

- [ ] **Step 8: If any step fails, STOP and trigger rollback (Phase 7 rollback procedure)**

---

### Task 31: T+12m — Backfill `profiles.track='tir'`

**Files:** none

- [ ] **Step 1: Run the backfill**

```sql
BEGIN;
UPDATE profiles SET track='tir' WHERE track IS NULL;
SELECT count(*) FROM profiles WHERE track IS NULL;   -- expect 0
SELECT track, count(*) FROM profiles GROUP BY track; -- mostly 'tir', possibly some 'sip' if any pre-set
COMMIT;
```

---

### Task 32: T+13m — Deploy new Lambda code

**Files:** none

- [ ] **Step 1: From the release branch worktree, verify state**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/release-sip-launch-v1
git status   # release/sip-launch-v1, clean
```

- [ ] **Step 2: SAM deploy**

```bash
cd infra/sam
./deploy-prod.sh
```

- [ ] **Step 3: Verify deployment**

```bash
curl -s https://api.artpark.info/health | jq
# expect: version 0.9.0-sip, status ok
curl -s https://api.artpark.info/health/ready | jq
# expect: all checks pass
```

---

### Task 33: T+17m — Promote real frontend on Vercel

**Files:** none

- [ ] **Step 1: In Vercel dashboard, find the `release/sip-launch-v1` deployment**

Vercel auto-builds on push. If the build isn't ready yet, wait.

- [ ] **Step 2: Promote to Production**

Click "Promote to Production". Wait for promotion.

- [ ] **Step 3: Verify in fresh incognito**

`https://apply.artpark.info` should show the public homepage with the SIP chooser available. NO maintenance page.

---

### Task 34: T+19m — Smoke test

**Files:** none

Run through all 24 smoke test rows from the spec (Section 6, T+19m table). For each row, perform the test and record pass/fail. If any row fails → rollback.

Key rows:
- Rows 1-3: public landing + signin + health
- Rows 4-9: existing TIR applicant continuity
- Rows 10-13: new signup multi-track drafting + cross-track submit lock
- Rows 14-18: schema / bucket state
- Rows 19-21: auth flow (signup, signin via password, signin via OTP)
- Rows 22-24: TIR email, SIP email, Resend dashboard health

---

### Task 35: T+22m — CloudWatch sanity

**Files:** none

- [ ] **Step 1: Tail Lambda logs**

```bash
aws logs tail /aws/lambda/artpark-eir-api-production --since 30m --region ap-south-1 \
  | grep -iE 'error|exception|traceback' | head -20
```
Expected: nothing real (CORS preflight 404s and some OPTIONS noise is normal).

- [ ] **Step 2: Verify alarms are OK**

```bash
aws cloudwatch describe-alarms --region ap-south-1 \
  --alarm-name-prefix artpark-eir-api-production \
  --query 'MetricAlarms[].[AlarmName,StateValue]' --output table
```
Expected: all OK or INSUFFICIENT_DATA (new alarms haven't had enough data yet).

---

### Task 36: T+25m — Cutover declared done

**Files:** none

- [ ] **Step 1: Announce in cutover channel**

"Cutover complete. apply.artpark.info live. SIP track available. No leadership users created (deferred to next push). Monitoring continues 48h."

- [ ] **Step 2: Unfreeze deploys**

Inform team that normal deploy activity can resume.

---

## Phase 7 — Post-cutover

### Task 37: Stage D verification spot-checks (within 24h)

**Files:** none

- [ ] **Step 1: Existing TIR applicant — full continuity check**

Sign in as a known prod applicant test account (from Task 19). Verify `/apply/submitted` shows their submitted history. Click any submitted app → answers + uploaded files visible. Pick SIP from chooser → SIP wizard accessible → draft + save works. Try to submit SIP → 409. SIP draft stays viewable.

- [ ] **Step 2: New signup — draft both, submit one**

Fresh email → signup → pick TIR → save draft → back to chooser → pick SIP → save draft → log out → log back in → both drafts persist. Submit TIR → SIP submit now blocked.

- [ ] **Step 3: New signup — SIP-first, full field coverage**

Another fresh email → pick SIP → fill EVERY field, upload every file → submit. Verify `sip_applications` row populated; files in correct buckets; `/apply/submitted` shows submission; TIR submit now blocked.

- [ ] **Step 4: SIP template upload + parse**

Another fresh email → pick SIP → use offline template upload → upload filled .docx → verify `sip_application_templates.parse_status='completed'`, parsed answers populate `sip_applications`.

- [ ] **Step 5: Storage spot-check on 5 random prod TIR rows**

```sql
SELECT id, user_id, evidence_files FROM tir_applications
WHERE submitted_at IS NOT NULL ORDER BY random() LIMIT 5;
```
For each, pick one entry from `evidence_files` JSONB, get its `storage_path`, signed-URL it via Supabase dashboard. Confirm 200 download.

---

### Task 38: Resend deliverability check (within 24h)

**Files:** none

- [ ] **Step 1: Open Resend dashboard**

Filter to last 24 hours.

- [ ] **Step 2: Confirm no bounces, no spam complaints**

Expected: all post-cutover submissions show `delivered` status.

- [ ] **Step 3: Verify domain auth state**

Resend → Domains → `artpark.info` → confirm DKIM, SPF, DMARC all green.

---

### Task 39: 48h monitoring

**Files:** none

- [ ] **Step 1: Daily Lambda + alarm check (run at 24h and 48h marks)**

```bash
aws logs tail /aws/lambda/artpark-eir-api-production --since 24h --region ap-south-1 \
  | grep -iE 'error|exception|traceback' | wc -l

aws cloudwatch describe-alarms --region ap-south-1 \
  --alarm-name-prefix artpark-eir-api-production \
  --query 'MetricAlarms[].[AlarmName,StateValue]' --output table
```
Expected: error count flat (some background noise OK), all alarms OK.

- [ ] **Step 2: Sentry check**

Open Sentry → prod project → last 24h. Expected: no new issue spikes; new SIP-flow issues investigated as they appear.

- [ ] **Step 3: Daily dashboard render time check (if any leadership user gets created)**

Not applicable for this push (no leadership users yet).

---

### Task 40: Archive backup tables + update docs

**Files:** `docs/ARCHITECTURE.md` (modify)

- [ ] **Step 1: Move backup tables to archive schema**

In prod Supabase SQL editor:
```sql
CREATE SCHEMA IF NOT EXISTS archive;
ALTER TABLE applications_backup_2026_05_26    SET SCHEMA archive;
ALTER TABLE resume_uploads_backup_2026_05_26  SET SCHEMA archive;
ALTER TABLE profiles_backup_2026_05_26        SET SCHEMA archive;
ALTER TABLE support_tickets_backup_2026_05_26 SET SCHEMA archive;
```

Schedule a calendar reminder for 30 days out to drop these archive tables.

- [ ] **Step 2: Update docs/ARCHITECTURE.md**

Document the new prod state:
- Dual-track schema live (`tir_applications` + `sip_applications`)
- SIP chooser live on `/apply`
- Cross-track submit lock active
- Leadership push (admin platform) is the next major work

Open `docs/ARCHITECTURE.md` and add a "2026-05-26 SIP cutover" section near the top under the relevant Phase header. Describe what shipped.

- [ ] **Step 3: Commit on main**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/staging-role_based_dashboard
git checkout main
git pull
# Make the docs change here, or cherry-pick from release branch
git add docs/ARCHITECTURE.md
git commit -m "docs: record 2026-05-26 SIP cutover to prod"
git push origin main
```

- [ ] **Step 4: Merge `release/sip-launch-v1` back into `staging` and `main`**

```bash
git checkout staging
git pull
git merge release/sip-launch-v1 --no-ff
git push origin staging

git checkout main
git pull
git merge release/sip-launch-v1 --no-ff
git push origin main
```
Resolve any conflicts. The release branch is now permanently merged; cutover artifact is on main.

---

## Rollback procedures (if cutover fails)

### Zone A — before T+5m (migrations not yet applied)

- [ ] **Step 1: Promote previous Vercel production deployment**

In Vercel dashboard → find the previous prod deployment (pre-maintenance) → "Promote to Production".

- [ ] **Step 2: Done**

Site is back. No DB changes happened. ~5 min downtime total.

### Zone B — T+5m to T+13m (migrations applied, new Lambda not yet deployed)

- [ ] **Step 1: PITR restore prod Supabase to T-1m**

Supabase dashboard → prod → Database → Backups → "Restore to point in time" → pick timestamp 1 min before Task 30. Wait ~30-60 min.

- [ ] **Step 2: Once restore completes, promote previous Vercel build**

Same as Zone A Step 1.

- [ ] **Step 3: Done**

Site is back to pre-cutover state. ~30-90 min downtime.

### Zone C — T+13m to T+25m (new Lambda deployed, all migrations applied)

- [ ] **Step 1: PITR restore prod Supabase (parallel)**

Same as Zone B Step 1. Start this immediately.

- [ ] **Step 2: While restore runs, redeploy old Lambda**

```bash
git worktree add /tmp/rollback origin/main
cd /tmp/rollback
# Verify the old .env.prod is on the deploy machine (pre-cutover state)
cd infra/sam
./deploy-prod.sh
```

- [ ] **Step 3: After Supabase restore completes, promote previous Vercel build**

- [ ] **Step 4: Verify health**

```bash
curl https://api.artpark.info/health
```
Expected: returns version `0.1.0` (the previous version), status ok.

- [ ] **Step 5: Done**

~35-65 min downtime.

### Zone D — post T+25m (site live)

| Problem | Action |
|---|---|
| Frontend bug only | Promote previous Vercel build (~5 min) |
| Backend bug, no data corruption | Fix-forward via SAM redeploy (~10 min) |
| Subtle / minority bug | Fix-forward |
| Data corruption | PITR restore to T+25m, lose post-cutover writes (~30-60 min + data loss) |

Fix-forward is the default in Zone D. PITR is reserved for genuine corruption.

---

## Self-review checklist (run before declaring plan ready)

- [ ] Every task has exact file paths and concrete code (no "TBD", no "implement appropriate X")
- [ ] Migration order is 010 → 011 → 012 → 013 → [019 if missing] → 020 → 021
- [ ] Test data purge happens BEFORE migrations (Task 29 before Task 30)
- [ ] `profiles.track` backfill happens AFTER migration 010 (Task 31 after Task 30)
- [ ] Lambda deploy happens AFTER migrations (Task 32 after Task 30)
- [ ] Frontend promote happens AFTER Lambda deploy (Task 33 after Task 32)
- [ ] Cross-track submit lock has tests for both directions (TIR-blocks-SIP and SIP-blocks-TIR)
- [ ] No leadership / admin / AI scoring code mentioned (that's the next push)
- [ ] Rollback procedure exists for each cutover zone
- [ ] Spec constraints all covered: data preservation, single-submit cross-track, auth flow unchanged, dual-track email parity, comprehensive field coverage

---

## Open items (resolve during execution, not blocking plan approval)

1. **Migration 019 drift state** — resolved in Task 3 before cutover.
2. **Frontend track-toggle on chooser pick** — resolved in Task 8 (read code, add if missing).
3. **SIP RLS vs draft-both tension** — addressed in Task 8 (frontend toggles `profiles.track` so RLS gate matches current wizard). If a cleaner solution emerges (drop the RLS gate), it can land in a follow-up patch.
4. **Cutover timing** — pick after dry-run (Task 23) completes successfully. Suggest 9-10pm IST Sunday for first attempt.
