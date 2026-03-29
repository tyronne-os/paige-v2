# Google Cloud Security Hardening Checklist

**Project:** WELCOME TO EDEN
**Project ID:** welcome-to-eden-491719
**Project Number:** 873829786119
**Owner:** aimasterandjoel@gmail.com
**Last Updated:** 2026-03-29

---

## THREAT MODEL

This checklist is designed to protect against:

| Threat | Risk Level | Primary Defenses |
|--------|-----------|-----------------|
| Account hijacking | CRITICAL | 2FA, Advanced Protection, recovery options |
| Unauthorized admin access | CRITICAL | IAM least privilege, audit logs, alerts |
| API key theft | HIGH | Key restrictions, rotation, monitoring |
| Service account exploitation | HIGH | No exported keys, Workload Identity, scoped roles |
| Billing fraud | HIGH | Budget alerts, billing caps, anomaly detection |
| Remote hacking attempts | HIGH | Firewall rules, VPC, no public endpoints |

---

## PHASE 1: GOOGLE ACCOUNT SECURITY (Do First)

These steps protect the Google Account itself (aimasterandjoel@gmail.com). A compromised Google Account means a compromised Cloud project.

### 1.1 Enable 2-Step Verification (2FA)

- [ ] Go to https://myaccount.google.com/security
- [ ] Under "How you sign in to Google," click **2-Step Verification**
- [ ] Enable 2-Step Verification if not already on
- [ ] Add a **hardware security key** (YubiKey) as primary method -- strongest option
- [ ] Add **Google Authenticator** or **Authy** as a backup method
- [ ] Remove SMS-based verification if possible (SIM swap vulnerable)
- [ ] Generate and securely store **backup codes** offline (printed, in a safe)

### 1.2 Google Advanced Protection Program

This is the strongest account protection Google offers. Recommended for high-value accounts.

- [ ] Go to https://landing.google.com/advancedprotection/
- [ ] Enroll aimasterandjoel@gmail.com
- [ ] Requirements: 2 hardware security keys (FIDO2), or phone's built-in key + 1 hardware key
- [ ] Understand limitations: Some third-party apps may lose access, stricter download scanning
- [ ] Complete enrollment

### 1.3 Recovery Options

- [ ] Go to https://myaccount.google.com/security
- [ ] Set a **recovery phone number** (one you physically control, not a VoIP number)
- [ ] Set a **recovery email** (a DIFFERENT email account, also with 2FA)
- [ ] Review "Your devices" and remove any unrecognized devices
- [ ] Review "Third-party apps with account access" and revoke unnecessary ones

### 1.4 Account Activity Monitoring

- [ ] Go to https://myaccount.google.com/notifications
- [ ] Enable security alerts for all sign-in activity
- [ ] Review recent security events at https://myaccount.google.com/security-checkup
- [ ] Check "Recent security activity" for any unfamiliar sign-ins

---

## PHASE 2: IAM & ACCESS CONTROL

### 2.1 Review IAM Members

- [ ] Go to https://console.cloud.google.com/iam-admin/iam?project=welcome-to-eden-491719
- [ ] Audit every member listed. For each one, ask:
  - Do I recognize this account?
  - Does it need this level of access?
  - Is it a person or a service account?
- [ ] Remove any unrecognized members immediately
- [ ] Document all authorized members and their justification

### 2.2 Apply Least Privilege

- [ ] Replace **Owner** role with more specific roles where possible:
  - For deployment: `roles/clouddeploy.admin`
  - For monitoring: `roles/monitoring.admin`
  - For storage: `roles/storage.admin`
  - For functions: `roles/cloudfunctions.admin`
- [ ] Replace **Editor** role wherever it appears -- it is almost as powerful as Owner
- [ ] Use **predefined roles** instead of **basic roles** (Owner/Editor/Viewer)
- [ ] Consider **custom roles** for very specific permission needs

### 2.3 Service Account Lockdown

- [ ] Go to https://console.cloud.google.com/iam-admin/serviceaccounts?project=welcome-to-eden-491719
- [ ] For each service account:
  - [ ] If unused: **disable** or **delete** it
  - [ ] If active: verify it has only the minimum roles needed
  - [ ] Check for **user-managed keys** (the key icon) -- delete all exported keys
  - [ ] Prefer **Workload Identity Federation** over exported keys
- [ ] Disable the default Compute Engine service account if not using Compute
- [ ] Disable the default App Engine service account if not using App Engine

### 2.4 Service Account Key Policy

- [ ] **Goal: Zero user-managed service account keys**
- [ ] Delete all existing user-managed keys
- [ ] Use attached service accounts (for GCE, Cloud Run, Cloud Functions)
- [ ] Use Workload Identity Federation for external services (GitHub Actions, etc.)
- [ ] If a key is absolutely necessary:
  - [ ] Rotate it every 90 days
  - [ ] Never commit it to git
  - [ ] Store in Secret Manager
  - [ ] Restrict the SA to minimum permissions

### 2.5 Conditional IAM Bindings

For extra protection, add IAM conditions:

- [ ] Time-based conditions: Allow access only during business hours
- [ ] IP-based conditions: Restrict admin access to known IPs
- [ ] Resource-based conditions: Limit SA to specific resources

How to add conditions:
1. Go to IAM page
2. Click the pencil icon next to a member
3. Click "Add condition"
4. Use CEL expressions, e.g.:
   - `request.time.getHours("America/Chicago") >= 8 && request.time.getHours("America/Chicago") <= 20`

---

## PHASE 3: API SECURITY

### 3.1 API Key Restrictions

- [ ] Go to https://console.cloud.google.com/apis/credentials?project=welcome-to-eden-491719
- [ ] For EVERY API key:
  - [ ] Click on the key name
  - [ ] Under **Application restrictions**, set one of:
    - HTTP referrers (websites)
    - IP addresses (servers)
    - Android apps
    - iOS apps
  - [ ] Under **API restrictions**, select "Restrict key" and choose ONLY the APIs it needs
  - [ ] Click Save
- [ ] Delete any API keys you don't recognize or no longer use
- [ ] Never embed API keys in client-side code without referrer restrictions

### 3.2 OAuth Consent Screen

- [ ] Go to https://console.cloud.google.com/apis/credentials/consent?project=welcome-to-eden-491719
- [ ] Set app to **Internal** if only your organization uses it
- [ ] Review authorized domains
- [ ] Review scopes -- minimize to what's actually needed

### 3.3 API Quotas

- [ ] Go to https://console.cloud.google.com/apis/dashboard?project=welcome-to-eden-491719
- [ ] For each enabled API, click on it and review usage
- [ ] Set **quota limits** below default for APIs you use lightly
- [ ] This prevents cost explosion if a key is stolen

---

## PHASE 4: AUDIT LOGGING & MONITORING

### 4.1 Enable Comprehensive Audit Logs

- [ ] Go to https://console.cloud.google.com/iam-admin/audit?project=welcome-to-eden-491719
- [ ] Enable **Admin Read**, **Data Read**, and **Data Write** for all services
- [ ] At minimum, enable for:
  - Cloud IAM
  - Cloud Storage
  - Compute Engine
  - Cloud Functions
  - Cloud Run
  - BigQuery
  - Cloud SQL

### 4.2 Log Retention

- [ ] Go to https://console.cloud.google.com/logs/storage?project=welcome-to-eden-491719
- [ ] Set **_Default** bucket retention to **365 days** minimum
- [ ] Set **_Required** bucket retention to **400 days** (max)
- [ ] Consider creating a **locked log sink** to Cloud Storage for tamper-proof archival

### 4.3 Create Critical Log-Based Alerts

Go to https://console.cloud.google.com/monitoring/alerting?project=welcome-to-eden-491719

Create alert policies for these log filters:

**Alert 1: IAM Policy Changes**
```
protoPayload.methodName="SetIamPolicy"
```

**Alert 2: Service Account Key Creation**
```
protoPayload.methodName="google.iam.admin.v1.CreateServiceAccountKey"
```

**Alert 3: New Service Account Created**
```
protoPayload.methodName="google.iam.admin.v1.CreateServiceAccount"
```

**Alert 4: Firewall Rule Changes**
```
resource.type="gce_firewall_rule" AND
protoPayload.methodName=("v1.compute.firewalls.insert" OR "v1.compute.firewalls.update" OR "v1.compute.firewalls.delete")
```

**Alert 5: Audit Log Configuration Changes**
```
protoPayload.methodName="SetIamPolicy" AND
protoPayload.request.policy.auditConfigs:*
```

**Alert 6: API Key Activity**
```
protoPayload.serviceName="apikeys.googleapis.com"
```

**Alert 7: Billing Account Changes**
```
protoPayload.methodName=("cloudbilling.billingAccounts.update" OR "cloudbilling.projects.updateBillingInfo")
```

For each alert:
1. Go to Monitoring > Alerting > Create Policy
2. Click "Add Condition" > "Log-based"
3. Paste the filter
4. Set notification channel to aimasterandjoel@gmail.com
5. Set notification rate limit to 5 minutes

### 4.4 Security Command Center

- [ ] Go to https://console.cloud.google.com/security/overview?project=welcome-to-eden-491719
- [ ] Activate Security Command Center (Standard tier is free)
- [ ] Enable all built-in detectors:
  - Security Health Analytics
  - Web Security Scanner
  - Event Threat Detection (Premium)
  - Container Threat Detection (if using containers)
- [ ] Review and remediate all findings
- [ ] Set up SCC notification exports to Pub/Sub or email

---

## PHASE 5: NETWORK SECURITY

### 5.1 VPC Configuration (if using Compute/GKE/Cloud Run)

- [ ] Delete the **default** VPC network if it exists
- [ ] Create a custom VPC with:
  - Private Google Access enabled
  - Flow logs enabled on all subnets
  - No public subnets unless absolutely necessary
- [ ] Use Cloud NAT for outbound internet access from private VMs

### 5.2 Firewall Rules

- [ ] Go to https://console.cloud.google.com/networking/firewalls/list?project=welcome-to-eden-491719
- [ ] Delete all `default-allow-*` rules
- [ ] Create explicit allow rules for only the traffic you need
- [ ] Never use `0.0.0.0/0` as source range for SSH (port 22) or RDP (port 3389)
- [ ] Use **IAP (Identity-Aware Proxy)** for SSH/RDP instead of open firewall rules
- [ ] Enable **Firewall Insights** to find unused or overly permissive rules

### 5.3 VPC Service Controls (Advanced)

If your project handles sensitive data:

- [ ] Go to https://console.cloud.google.com/security/service-perimeter?project=welcome-to-eden-491719
- [ ] Create a service perimeter around your project
- [ ] This prevents data exfiltration even if an attacker gains IAM access
- [ ] Note: Requires an Organization

### 5.4 Private Google Access

- [ ] Enable Private Google Access on all subnets
- [ ] This allows VMs without external IPs to still reach Google APIs
- [ ] Reduces need for public IPs

---

## PHASE 6: BILLING PROTECTION

### 6.1 Budget Alerts

- [ ] Go to https://console.cloud.google.com/billing (select your billing account)
- [ ] Click **Budgets & alerts**
- [ ] Create a budget:
  - Name: "EDEN Monthly Cap"
  - Scope: Project "welcome-to-eden-491719"
  - Budget amount: Set to your expected monthly max (e.g., $50, $100)
  - Alert thresholds: 50%, 80%, 100%, 150%
  - Notification channels: aimasterandjoel@gmail.com
  - [ ] Optionally: Connect to Pub/Sub to trigger automatic project shutdown

### 6.2 Billing Export

- [ ] Enable billing export to BigQuery for cost analysis
- [ ] Go to Billing > Billing export > BigQuery export > Enable

### 6.3 Quotas as Safety Nets

- [ ] Go to https://console.cloud.google.com/iam-admin/quotas?project=welcome-to-eden-491719
- [ ] Lower quotas for services you use lightly:
  - Compute Engine: Reduce CPU/GPU quotas
  - Cloud Functions: Reduce concurrent execution limits
  - Cloud Run: Reduce max instances
- [ ] This prevents runaway costs even if an attacker gains access

### 6.4 Billing Account Access

- [ ] Go to https://console.cloud.google.com/billing
- [ ] Click on your billing account > Account management
- [ ] Review who has Billing Account Administrator or Billing Account User roles
- [ ] Remove any unrecognized accounts
- [ ] Only the primary owner should have Billing Account Administrator

---

## PHASE 7: DATA PROTECTION

### 7.1 Cloud Storage

- [ ] Enable **uniform bucket-level access** on all buckets
- [ ] Enable **Object Versioning** on critical buckets
- [ ] Enable **Bucket Lock** (retention policy) on compliance-sensitive data
- [ ] Never grant `allUsers` or `allAuthenticatedUsers` access
- [ ] Use **Customer-Managed Encryption Keys (CMEK)** for sensitive data

### 7.2 Secret Manager

- [ ] Go to https://console.cloud.google.com/security/secret-manager?project=welcome-to-eden-491719
- [ ] Store ALL secrets (API keys, tokens, passwords) in Secret Manager
- [ ] Never store secrets in:
  - Environment variables visible in Cloud Run/Functions config
  - Source code or git repos
  - Cloud Storage objects without encryption
- [ ] Rotate secrets regularly (set up automatic rotation if possible)

### 7.3 Cloud KMS

- [ ] Consider using Cloud KMS for encrypting sensitive data
- [ ] Create a key ring and crypto key for each classification level
- [ ] Use envelope encryption for large data sets

---

## PHASE 8: ORGANIZATION POLICIES (If org available)

If your project is under a Google Cloud Organization, enforce these org policies:

### 8.1 Critical Org Policies to Enable

- [ ] `constraints/iam.allowedPolicyMemberDomains` -- Restrict who can be granted IAM roles to only your domain
- [ ] `constraints/iam.disableServiceAccountKeyCreation` -- Block SA key exports
- [ ] `constraints/iam.disableServiceAccountKeyUpload` -- Block SA key uploads
- [ ] `constraints/compute.requireOsLogin` -- Force OS Login on all VMs
- [ ] `constraints/compute.disableSerialPortAccess` -- Block serial console
- [ ] `constraints/compute.vmExternalIpAccess` -- Restrict which VMs can have external IPs
- [ ] `constraints/storage.uniformBucketLevelAccess` -- Force uniform access on all buckets
- [ ] `constraints/sql.restrictPublicIp` -- Block public IPs on Cloud SQL instances
- [ ] `constraints/compute.restrictVpcPeering` -- Control VPC peering

### 8.2 Setting Org Policies

1. Go to https://console.cloud.google.com/iam-admin/orgpolicies?project=welcome-to-eden-491719
2. Search for the constraint name
3. Click on it and select "Customize"
4. Set enforcement to "On" for boolean constraints
5. For list constraints, specify allowed/denied values

---

## PHASE 9: INCIDENT RESPONSE PREPARATION

### 9.1 Create an Incident Response Plan

Document answers to these questions:

- [ ] Who is notified first? (TJ -- aimasterandjoel@gmail.com)
- [ ] What is the first action? (Revoke compromised credentials, see below)
- [ ] Where are backups? (Document backup locations)
- [ ] When was the last backup tested?

### 9.2 Emergency Credential Revocation

If you suspect compromise, do these in order:

1. **Immediately** change your Google Account password at https://myaccount.google.com
2. **Revoke all sessions**: https://myaccount.google.com/security > "Manage all third-party access"
3. **Disable all service account keys**:
   ```bash
   # List all SAs
   gcloud iam service-accounts list --project=welcome-to-eden-491719
   # For each SA, disable all keys:
   gcloud iam service-accounts keys disable KEY_ID --iam-account=SA_EMAIL
   ```
4. **Rotate all API keys** in Console > APIs & Services > Credentials
5. **Check IAM policy** for unauthorized members and remove them
6. **Review audit logs** for the timeline of compromise:
   ```bash
   gcloud logging read "protoPayload.methodName='SetIamPolicy'" \
     --project=welcome-to-eden-491719 --freshness=7d --format=json
   ```
7. **Contact Google Cloud Support** if billing fraud is suspected

### 9.3 Recovery Contacts

- Google Cloud Support: https://cloud.google.com/support
- Google Account Recovery: https://accounts.google.com/signin/recovery
- Billing Disputes: https://cloud.google.com/billing/docs/how-to/dispute

---

## PHASE 10: ONGOING MAINTENANCE

### 10.1 Monthly Tasks

- [ ] Run `gcloud-security.sh` audit script
- [ ] Review IAM members and remove unnecessary access
- [ ] Review audit logs for suspicious activity
- [ ] Check Security Command Center findings
- [ ] Verify budget alerts are still correct
- [ ] Review enabled APIs and disable unused ones

### 10.2 Quarterly Tasks

- [ ] Rotate any remaining service account keys
- [ ] Rotate API keys
- [ ] Review and update firewall rules
- [ ] Test incident response procedures
- [ ] Review third-party app access on Google Account
- [ ] Update this checklist with new threats

### 10.3 Annual Tasks

- [ ] Full IAM access review with documented justification
- [ ] Review organization policies
- [ ] Penetration testing if applicable
- [ ] Update recovery contacts and backup procedures
- [ ] Review Google Cloud security advisories

---

## QUICK REFERENCE: Console URLs

| Resource | URL |
|----------|-----|
| IAM | https://console.cloud.google.com/iam-admin/iam?project=welcome-to-eden-491719 |
| Service Accounts | https://console.cloud.google.com/iam-admin/serviceaccounts?project=welcome-to-eden-491719 |
| API Credentials | https://console.cloud.google.com/apis/credentials?project=welcome-to-eden-491719 |
| Audit Logs | https://console.cloud.google.com/iam-admin/audit?project=welcome-to-eden-491719 |
| Log Explorer | https://console.cloud.google.com/logs/query?project=welcome-to-eden-491719 |
| Monitoring Alerts | https://console.cloud.google.com/monitoring/alerting?project=welcome-to-eden-491719 |
| Security Command Center | https://console.cloud.google.com/security/overview?project=welcome-to-eden-491719 |
| Firewall Rules | https://console.cloud.google.com/networking/firewalls/list?project=welcome-to-eden-491719 |
| Budgets | https://console.cloud.google.com/billing |
| Org Policies | https://console.cloud.google.com/iam-admin/orgpolicies?project=welcome-to-eden-491719 |
| Secret Manager | https://console.cloud.google.com/security/secret-manager?project=welcome-to-eden-491719 |
| Quotas | https://console.cloud.google.com/iam-admin/quotas?project=welcome-to-eden-491719 |
| Google Account Security | https://myaccount.google.com/security |
| Advanced Protection | https://landing.google.com/advancedprotection/ |

---

## PRIORITY ORDER

If you can only do a few things, do these first:

1. **Enable 2FA on your Google Account** (Phase 1.1)
2. **Enroll in Advanced Protection** (Phase 1.2)
3. **Review IAM members** (Phase 2.1)
4. **Delete all service account keys** (Phase 2.4)
5. **Restrict all API keys** (Phase 3.1)
6. **Enable audit logging** (Phase 4.1)
7. **Set up budget alerts** (Phase 6.1)
8. **Create IAM change alerts** (Phase 4.3)
