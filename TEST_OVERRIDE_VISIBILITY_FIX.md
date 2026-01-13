# Override Request Visibility Fix - Test Scenarios

## Issue Fixed
Finance admin created an override request but it was not visible to compliance admin.

## Root Cause
The `approval_requests` table stores `tenantId` in the JSONB `request_data` field, not as a separate column. Both the Finance Admin and Compliance Admin API endpoints were returning **all** pending requests across all tenants without filtering, but the frontend was supposed to filter by tenant. The Compliance Admin frontend was not passing the `tenantId` parameter to the API.

## Changes Made

### Backend Changes

#### 1. Compliance Admin API (`src/api/compliance-admin-routes.js`)
- **Endpoint**: `GET /api/compliance-admin/overrides/pending`
- **Change**: Now requires `tenantId` query parameter and filters using PostgreSQL JSONB operator
- **Query Filter**: `.whereRaw("ar.request_data->>'tenantId' = ?", [tenantId])`

#### 2. Finance Admin API (`src/api/finance-admin-routes.js`)
- **Endpoint**: `GET /api/finance-admin/overrides/pending`
- **Change**: Now accepts optional `tenantId` query parameter and filters when provided
- **Query Filter**: Same as Compliance Admin

### Frontend Changes

#### 3. Compliance Admin Portal (`public/compliance-admin-portal.html`)
- **Change**: Line 997 now passes tenantId as query parameter
- **Before**: `apiCall('/overrides/pending')`
- **After**: `apiCall('/overrides/pending?tenantId=${currentTenantId}')`

#### 4. Finance Admin Console (`public/finance-admin-console.html`)
- **Change**: Line 1298 now passes tenantId as query parameter
- **Before**: `apiCall('/overrides/pending')`
- **After**: `apiCall('/overrides/pending?tenantId=${currentTenantId}')`

### Test Changes

#### 5. Compliance Admin Test (`tests/compliance-admin-portal.test.js`)
- **Change**: Test now includes tenantId parameter
- **Update**: Line 111 adds `?tenantId=${TEST_TENANT_ID}`

## Test Scenarios

### Scenario 1: Compliance Admin Can See Override Requests for Their Tenant

**Prerequisites:**
1. Server running on `http://localhost:3000`
2. Database with at least one tenant (e.g., `tenant-A-uuid`)
3. Finance Admin user exists in database
4. Compliance Admin user exists in database

**Steps:**
1. Login as Finance Admin for Tenant A
2. Navigate to "Override Approvals" tab
3. Click "Request Override"
4. Select override type: "SOFT_CLOSE_POSTING"
5. Enter justification: "Need to post correction to closed period"
6. Submit request
7. Logout and login as Compliance Admin for Tenant A
8. Navigate to "Override Approvals" tab
9. **Expected Result**: The override request created by Finance Admin should be visible
10. Click "Approve" button
11. Enter approval reason
12. Submit approval
13. **Expected Result**: Request should be approved successfully

### Scenario 2: Compliance Admin Cannot See Override Requests from Other Tenants

**Prerequisites:**
1. Two tenants exist: Tenant A and Tenant B
2. Finance Admin for Tenant A exists
3. Compliance Admin for Tenant B exists

**Steps:**
1. Login as Finance Admin for Tenant A
2. Create an override request for Tenant A
3. Logout and login as Compliance Admin for Tenant B
4. Navigate to "Override Approvals" tab
5. **Expected Result**: The override request from Tenant A should NOT be visible
6. Only requests for Tenant B should be shown (if any exist)

### Scenario 3: API Validation

**Test 1: Without tenantId (Compliance Admin)**
```bash
curl -X GET "http://localhost:3000/api/compliance-admin/overrides/pending" \
  -H "x-user-role: COMPLIANCE_ADMIN" \
  -H "x-user-id: compliance-user-uuid" \
  -H "x-user-email: compliance@test.com"
```
**Expected**: 400 Bad Request with error "tenantId is required"

**Test 2: With invalid tenantId**
```bash
curl -X GET "http://localhost:3000/api/compliance-admin/overrides/pending?tenantId=invalid-uuid" \
  -H "x-user-role: COMPLIANCE_ADMIN" \
  -H "x-user-id: compliance-user-uuid" \
  -H "x-user-email: compliance@test.com"
```
**Expected**: 400 Bad Request with error "tenantId must be a valid UUID"

**Test 3: With valid tenantId**
```bash
curl -X GET "http://localhost:3000/api/compliance-admin/overrides/pending?tenantId=00000000-0000-0000-0000-000000000001" \
  -H "x-user-role: COMPLIANCE_ADMIN" \
  -H "x-user-id: compliance-user-uuid" \
  -H "x-user-email: compliance@test.com"
```
**Expected**: 200 OK with filtered list of pending requests for that tenant

**Test 4: Finance Admin with tenantId (optional filtering)**
```bash
curl -X GET "http://localhost:3000/api/finance-admin/overrides/pending?tenantId=00000000-0000-0000-0000-000000000001" \
  -H "x-user-role: FINANCE_ADMIN" \
  -H "x-user-id: finance-user-uuid" \
  -H "x-user-email: finance@test.com"
```
**Expected**: 200 OK with filtered list of pending requests for that tenant

**Test 5: Finance Admin without tenantId (shows all)**
```bash
curl -X GET "http://localhost:3000/api/finance-admin/overrides/pending" \
  -H "x-user-role: FINANCE_ADMIN" \
  -H "x-user-id: finance-user-uuid" \
  -H "x-user-email: finance@test.com"
```
**Expected**: 200 OK with all pending requests (no tenant filtering)

### Scenario 4: Database Query Verification

**Direct SQL to verify the fix logic:**
```sql
-- Create test data
INSERT INTO approval_requests (request_type, requestor_id, status, request_data)
VALUES (
  'SOFT_CLOSE_POSTING',
  'finance-admin-user-id',
  'pending',
  '{"tenantId": "tenant-A-uuid", "justification": "Test request", "overrideType": "SOFT_CLOSE_POSTING"}'::jsonb
);

-- Query that the API now uses (should return the record)
SELECT * FROM approval_requests
WHERE status = 'pending'
  AND request_type IN ('SOFT_CLOSE_POSTING', 'EXCEPTIONAL_CORRECTION')
  AND request_data->>'tenantId' = 'tenant-A-uuid';

-- Query for different tenant (should return empty)
SELECT * FROM approval_requests
WHERE status = 'pending'
  AND request_type IN ('SOFT_CLOSE_POSTING', 'EXCEPTIONAL_CORRECTION')
  AND request_data->>'tenantId' = 'tenant-B-uuid';
```

## Success Criteria

✅ **Fix is successful if:**
1. Compliance Admin can see override requests created by Finance Admin for the SAME tenant
2. Compliance Admin CANNOT see override requests from OTHER tenants
3. API returns 400 error when tenantId is missing (for Compliance Admin)
4. API returns 400 error when tenantId is invalid UUID format
5. Finance Admin can still see all requests when tenantId is not provided
6. Finance Admin can filter by tenantId when provided
7. The approval workflow still works correctly
8. No existing functionality is broken

## Rollback Plan

If the fix causes issues, rollback by reverting these files:
1. `src/api/compliance-admin-routes.js`
2. `src/api/finance-admin-routes.js`
3. `public/compliance-admin-portal.html`
4. `public/finance-admin-console.html`
5. `tests/compliance-admin-portal.test.js`

Command:
```bash
git revert <commit-hash>
```

## Technical Notes

- **PostgreSQL JSONB Operator**: The fix uses `request_data->>'tenantId'` to extract the tenantId as text from the JSONB column
- **Backward Compatibility**: Finance Admin endpoint maintains backward compatibility by making tenantId optional
- **Performance**: JSONB queries are efficient in PostgreSQL with proper indexing. Consider adding a GIN index if needed:
  ```sql
  CREATE INDEX idx_approval_requests_tenant_id ON approval_requests 
  USING gin (request_data jsonb_path_ops);
  ```
