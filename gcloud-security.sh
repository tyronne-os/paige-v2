#!/usr/bin/env bash
###############################################################################
# gcloud-security.sh - Google Cloud Security Audit & Hardening Script
#
# Project:  WELCOME TO EDEN
# ID:       welcome-to-eden-491719
# Number:   873829786119
# Owner:    aimasterandjoel@gmail.com
#
# Usage:    chmod +x gcloud-security.sh && ./gcloud-security.sh
#
# Prerequisites:
#   - gcloud CLI installed and authenticated (gcloud auth login)
#   - Owner or Security Admin role on the project
#   - APIs: cloudresourcemanager, iam, logging, securitycenter, billing
#
# This script is READ-HEAVY and WRITE-CAUTIOUS. Dangerous changes require
# confirmation. Audit results are saved to a timestamped report file.
###############################################################################

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
PROJECT_ID="welcome-to-eden-491719"
PROJECT_NUMBER="873829786119"
OWNER_EMAIL="aimasterandjoel@gmail.com"
REPORT_DIR="$HOME/paige-v2/security-reports"
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
REPORT_FILE="${REPORT_DIR}/security-audit-${TIMESTAMP}.txt"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ── Helpers ──────────────────────────────────────────────────────────────────
log()    { echo -e "${CYAN}[INFO]${NC}  $*" | tee -a "$REPORT_FILE"; }
warn()   { echo -e "${YELLOW}[WARN]${NC}  $*" | tee -a "$REPORT_FILE"; }
fail()   { echo -e "${RED}[FAIL]${NC}  $*" | tee -a "$REPORT_FILE"; }
pass()   { echo -e "${GREEN}[PASS]${NC}  $*" | tee -a "$REPORT_FILE"; }
banner() { echo -e "\n${CYAN}═══════════════════════════════════════════════════════════${NC}" | tee -a "$REPORT_FILE"
           echo -e "${CYAN}  $*${NC}" | tee -a "$REPORT_FILE"
           echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}\n" | tee -a "$REPORT_FILE"; }

confirm() {
    read -rp "$(echo -e "${YELLOW}[?] $1 (y/N): ${NC}")" ans
    [[ "$ans" =~ ^[Yy]$ ]]
}

mkdir -p "$REPORT_DIR"
echo "Security Audit Report - ${TIMESTAMP}" > "$REPORT_FILE"
echo "Project: ${PROJECT_ID} (${PROJECT_NUMBER})" >> "$REPORT_FILE"
echo "=========================================" >> "$REPORT_FILE"

# ── Preflight ────────────────────────────────────────────────────────────────
banner "PREFLIGHT CHECKS"

if ! command -v gcloud &>/dev/null; then
    fail "gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

ACTIVE_ACCOUNT=$(gcloud config get-value account 2>/dev/null || true)
ACTIVE_PROJECT=$(gcloud config get-value project 2>/dev/null || true)

log "Authenticated as: ${ACTIVE_ACCOUNT}"
log "Active project:   ${ACTIVE_PROJECT}"

if [[ "$ACTIVE_PROJECT" != "$PROJECT_ID" ]]; then
    warn "Active project differs from target. Setting project to ${PROJECT_ID}"
    gcloud config set project "$PROJECT_ID" 2>/dev/null
fi

# ── Enable required APIs ─────────────────────────────────────────────────────
banner "1. ENABLE REQUIRED SECURITY APIs"

REQUIRED_APIS=(
    "cloudresourcemanager.googleapis.com"
    "iam.googleapis.com"
    "logging.googleapis.com"
    "monitoring.googleapis.com"
    "securitycenter.googleapis.com"
    "cloudasset.googleapis.com"
    "accesscontextmanager.googleapis.com"
    "billingbudgets.googleapis.com"
    "serviceusage.googleapis.com"
    "cloudkms.googleapis.com"
    "containeranalysis.googleapis.com"
)

ENABLED_APIS=$(gcloud services list --enabled --format="value(config.name)" --project="$PROJECT_ID" 2>/dev/null || echo "")

for api in "${REQUIRED_APIS[@]}"; do
    if echo "$ENABLED_APIS" | grep -q "^${api}$"; then
        pass "Already enabled: ${api}"
    else
        if confirm "Enable ${api}?"; then
            gcloud services enable "$api" --project="$PROJECT_ID" 2>/dev/null && \
                pass "Enabled: ${api}" || fail "Failed to enable: ${api}"
        else
            warn "Skipped: ${api}"
        fi
    fi
done

# ── List all enabled APIs (flag unused / risky ones) ─────────────────────────
banner "2. AUDIT ENABLED APIs"

RISKY_APIS=(
    "deploymentmanager.googleapis.com"   # Can create any resource
    "cloudfunctions.googleapis.com"      # Arbitrary code execution
    "run.googleapis.com"                 # Arbitrary code execution
    "compute.googleapis.com"             # VMs = attack surface
    "sqladmin.googleapis.com"            # DB exposure
    "sourcerepo.googleapis.com"          # Code access
    "dataflow.googleapis.com"            # Can run arbitrary code
)

ALL_ENABLED=$(gcloud services list --enabled --format="value(config.name)" --project="$PROJECT_ID" 2>/dev/null)

log "Total enabled APIs: $(echo "$ALL_ENABLED" | wc -l)"
echo "$ALL_ENABLED" >> "$REPORT_FILE"

for api in "${RISKY_APIS[@]}"; do
    if echo "$ALL_ENABLED" | grep -q "^${api}$"; then
        warn "RISKY API enabled: ${api} - Disable if not needed"
    fi
done

echo ""
if confirm "List all enabled APIs to console?"; then
    echo "$ALL_ENABLED" | while read -r a; do log "  - $a"; done
fi

# ── IAM Audit ────────────────────────────────────────────────────────────────
banner "3. IAM POLICY AUDIT"

log "Fetching IAM policy..."
IAM_POLICY=$(gcloud projects get-iam-policy "$PROJECT_ID" --format=json 2>/dev/null)

if [[ -z "$IAM_POLICY" ]]; then
    fail "Could not retrieve IAM policy. Check permissions."
else
    pass "IAM policy retrieved."

    # Check for allUsers / allAuthenticatedUsers (public access)
    PUBLIC_BINDINGS=$(echo "$IAM_POLICY" | grep -c '"allUsers"\|"allAuthenticatedUsers"' || true)
    if [[ "$PUBLIC_BINDINGS" -gt 0 ]]; then
        fail "PUBLIC ACCESS DETECTED: ${PUBLIC_BINDINGS} bindings grant access to allUsers or allAuthenticatedUsers"
        echo "$IAM_POLICY" | grep -B5 '"allUsers"\|"allAuthenticatedUsers"' | tee -a "$REPORT_FILE"
    else
        pass "No public (allUsers/allAuthenticatedUsers) bindings found."
    fi

    # Check for Owner role grants (should be minimal)
    OWNER_COUNT=$(echo "$IAM_POLICY" | grep -c '"roles/owner"' || true)
    log "Owner role bindings: ${OWNER_COUNT}"
    if [[ "$OWNER_COUNT" -gt 1 ]]; then
        warn "Multiple Owner bindings detected. Minimize to 1-2 trusted accounts."
        echo "$IAM_POLICY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for b in data.get('bindings', []):
    if b['role'] == 'roles/owner':
        for m in b['members']:
            print(f'  Owner: {m}')
" 2>/dev/null | tee -a "$REPORT_FILE"
    fi

    # Check for Editor role (overly broad)
    EDITOR_COUNT=$(echo "$IAM_POLICY" | grep -c '"roles/editor"' || true)
    if [[ "$EDITOR_COUNT" -gt 0 ]]; then
        warn "roles/editor bindings found (${EDITOR_COUNT}). Prefer granular roles."
    else
        pass "No broad roles/editor bindings."
    fi

    # Check for primitive roles on service accounts
    echo "$IAM_POLICY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
primitives = {'roles/owner', 'roles/editor', 'roles/viewer'}
for b in data.get('bindings', []):
    if b['role'] in primitives:
        for m in b['members']:
            if 'serviceAccount:' in m:
                print(f'  WARNING: Service account {m} has primitive role {b[\"role\"]}')
" 2>/dev/null | tee -a "$REPORT_FILE"
fi

# ── Service Account Audit ────────────────────────────────────────────────────
banner "4. SERVICE ACCOUNT AUDIT"

log "Listing service accounts..."
SA_LIST=$(gcloud iam service-accounts list --project="$PROJECT_ID" --format="table(email,displayName,disabled)" 2>/dev/null)
echo "$SA_LIST" | tee -a "$REPORT_FILE"

SA_EMAILS=$(gcloud iam service-accounts list --project="$PROJECT_ID" --format="value(email)" 2>/dev/null)
SA_COUNT=$(echo "$SA_EMAILS" | grep -c "." || true)
log "Total service accounts: ${SA_COUNT}"

if [[ "$SA_COUNT" -gt 10 ]]; then
    warn "High number of service accounts (${SA_COUNT}). Review and remove unused ones."
fi

# Check for service account keys (external keys are a risk)
log "Checking for user-managed SA keys..."
while IFS= read -r sa_email; do
    [[ -z "$sa_email" ]] && continue
    KEYS=$(gcloud iam service-accounts keys list --iam-account="$sa_email" \
        --managed-by=user --format="value(name)" 2>/dev/null || true)
    if [[ -n "$KEYS" ]]; then
        KEY_COUNT=$(echo "$KEYS" | wc -l)
        fail "Service account ${sa_email} has ${KEY_COUNT} user-managed key(s) - HIGH RISK"
        echo "$KEYS" | while read -r k; do
            # Check key age
            KEY_CREATED=$(gcloud iam service-accounts keys list --iam-account="$sa_email" \
                --managed-by=user --format="value(validAfterTime)" 2>/dev/null | head -1)
            warn "  Key created: ${KEY_CREATED}"
        done
    else
        pass "No user-managed keys: ${sa_email}"
    fi
done <<< "$SA_EMAILS"

# Check default compute SA for Editor role
DEFAULT_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
if echo "$IAM_POLICY" | grep -q "$DEFAULT_SA"; then
    warn "Default compute service account has IAM bindings. Review carefully."
fi

# ── Cloud Audit Logs ─────────────────────────────────────────────────────────
banner "5. CLOUD AUDIT LOGGING"

log "Checking audit log configuration..."
AUDIT_CONFIG=$(gcloud projects get-iam-policy "$PROJECT_ID" --format=json 2>/dev/null | \
    python3 -c "
import sys, json
data = json.load(sys.stdin)
ac = data.get('auditConfigs', [])
if not ac:
    print('NO_AUDIT_CONFIG')
else:
    for c in ac:
        svc = c.get('service', 'unknown')
        for al in c.get('auditLogConfigs', []):
            print(f'{svc}: {al.get(\"logType\", \"unknown\")}')
" 2>/dev/null || echo "ERROR")

if [[ "$AUDIT_CONFIG" == "NO_AUDIT_CONFIG" ]]; then
    fail "No audit log configuration found!"
    if confirm "Enable DATA_READ, DATA_WRITE, and ADMIN_READ audit logs for all services?"; then
        # Create a temporary policy patch
        TEMP_POLICY=$(mktemp /tmp/audit-policy-XXXXXX.json)
        gcloud projects get-iam-policy "$PROJECT_ID" --format=json > "$TEMP_POLICY" 2>/dev/null

        python3 -c "
import json, sys
with open('${TEMP_POLICY}') as f:
    data = json.load(f)
data['auditConfigs'] = [{
    'service': 'allServices',
    'auditLogConfigs': [
        {'logType': 'ADMIN_READ'},
        {'logType': 'DATA_READ'},
        {'logType': 'DATA_WRITE'}
    ]
}]
with open('${TEMP_POLICY}', 'w') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null

        gcloud projects set-iam-policy "$PROJECT_ID" "$TEMP_POLICY" 2>/dev/null && \
            pass "Audit logs enabled for all services." || \
            fail "Failed to set audit log policy."
        rm -f "$TEMP_POLICY"
    fi
elif [[ "$AUDIT_CONFIG" == "ERROR" ]]; then
    fail "Error checking audit config."
else
    pass "Audit log configuration found:"
    echo "$AUDIT_CONFIG" | while read -r line; do log "  $line"; done
fi

# ── Log Sinks & Retention ───────────────────────────────────────────────────
banner "6. LOG SINKS & RETENTION"

log "Listing log sinks..."
SINKS=$(gcloud logging sinks list --project="$PROJECT_ID" --format="table(name,destination,filter)" 2>/dev/null || echo "NONE")
echo "$SINKS" | tee -a "$REPORT_FILE"

log "Checking log buckets and retention..."
gcloud logging buckets list --project="$PROJECT_ID" --format="table(name,retentionDays,locked)" 2>/dev/null | tee -a "$REPORT_FILE"

warn "RECOMMENDATION: Set _Default bucket retention to at least 365 days."
warn "RECOMMENDATION: Create a locked log sink to Cloud Storage for tamper-proof retention."

if confirm "Set _Default log bucket retention to 365 days?"; then
    gcloud logging buckets update _Default \
        --project="$PROJECT_ID" \
        --location=global \
        --retention-days=365 2>/dev/null && \
        pass "Log retention set to 365 days." || \
        fail "Failed to update log retention."
fi

# ── Monitoring & Alerting ────────────────────────────────────────────────────
banner "7. MONITORING & ALERT POLICIES"

log "Listing existing alert policies..."
ALERT_COUNT=$(gcloud alpha monitoring policies list --project="$PROJECT_ID" --format="value(name)" 2>/dev/null | wc -l || echo "0")
log "Existing alert policies: ${ALERT_COUNT}"

if [[ "$ALERT_COUNT" -eq 0 ]]; then
    warn "No alert policies configured!"
fi

# Create critical alert policies
if confirm "Create recommended alert policies for suspicious activity?"; then
    # Alert: IAM policy changes
    ALERT_TEMP=$(mktemp /tmp/alert-XXXXXX.json)

    cat > "$ALERT_TEMP" << 'ALERTEOF'
{
  "displayName": "SECURITY: IAM Policy Change Detected",
  "conditions": [{
    "displayName": "IAM Policy Changed",
    "conditionMatchedLog": {
      "filter": "protoPayload.methodName=\"SetIamPolicy\" OR protoPayload.methodName=\"google.iam.admin.v1.CreateServiceAccount\" OR protoPayload.methodName=\"google.iam.admin.v1.CreateServiceAccountKey\""
    }
  }],
  "combiner": "OR",
  "alertStrategy": {
    "notificationRateLimit": {
      "period": "300s"
    }
  },
  "documentation": {
    "content": "An IAM policy change was detected on the WELCOME TO EDEN project. Verify this was authorized.",
    "mimeType": "text/markdown"
  }
}
ALERTEOF

    # First create a notification channel (email)
    NOTIF_TEMP=$(mktemp /tmp/notif-XXXXXX.json)
    cat > "$NOTIF_TEMP" << EOF
{
  "type": "email",
  "displayName": "TJ Security Alerts",
  "labels": {
    "email_address": "${OWNER_EMAIL}"
  }
}
EOF

    NOTIF_CHANNEL=$(gcloud alpha monitoring channels create \
        --channel-content-from-file="$NOTIF_TEMP" \
        --project="$PROJECT_ID" \
        --format="value(name)" 2>/dev/null || echo "FAILED")

    if [[ "$NOTIF_CHANNEL" != "FAILED" && -n "$NOTIF_CHANNEL" ]]; then
        pass "Notification channel created: ${NOTIF_CHANNEL}"

        # Now create the alert with the channel
        python3 -c "
import json
with open('${ALERT_TEMP}') as f:
    data = json.load(f)
data['notificationChannels'] = ['${NOTIF_CHANNEL}']
with open('${ALERT_TEMP}', 'w') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null

        gcloud alpha monitoring policies create \
            --policy-from-file="$ALERT_TEMP" \
            --project="$PROJECT_ID" 2>/dev/null && \
            pass "Alert policy created: IAM Policy Change." || \
            fail "Failed to create IAM alert policy."
    else
        warn "Could not create notification channel. Create alerts manually in Console."
    fi

    rm -f "$ALERT_TEMP" "$NOTIF_TEMP"
fi

# ── API Key Audit ────────────────────────────────────────────────────────────
banner "8. API KEY AUDIT"

log "Listing API keys..."
API_KEYS=$(gcloud services api-keys list --project="$PROJECT_ID" --format="table(name,displayName,restrictions)" 2>/dev/null || echo "COMMAND_UNAVAILABLE")

if [[ "$API_KEYS" == "COMMAND_UNAVAILABLE" ]]; then
    warn "api-keys command not available. Check keys in Console: https://console.cloud.google.com/apis/credentials?project=${PROJECT_ID}"
else
    echo "$API_KEYS" | tee -a "$REPORT_FILE"

    # Check for unrestricted keys
    UNRESTRICTED=$(gcloud services api-keys list --project="$PROJECT_ID" --format=json 2>/dev/null | \
        python3 -c "
import sys, json
keys = json.load(sys.stdin)
for k in keys:
    restrictions = k.get('restrictions', {})
    api_targets = restrictions.get('apiTargets', [])
    browser = restrictions.get('browserKeyRestrictions', {})
    server = restrictions.get('serverKeyRestrictions', {})
    android = restrictions.get('androidKeyRestrictions', {})
    ios = restrictions.get('iosKeyRestrictions', {})
    if not api_targets and not browser and not server and not android and not ios:
        print(f'UNRESTRICTED: {k.get(\"displayName\", k.get(\"uid\", \"unknown\"))}')
" 2>/dev/null || true)

    if [[ -n "$UNRESTRICTED" ]]; then
        fail "Unrestricted API keys found:"
        echo "$UNRESTRICTED" | while read -r line; do fail "  $line"; done
        warn "ACTION: Restrict all API keys to specific APIs and IP/referrer restrictions."
    else
        pass "All API keys have restrictions (or no keys exist)."
    fi
fi

# ── Firewall Rules (if Compute is enabled) ───────────────────────────────────
banner "9. FIREWALL RULES AUDIT"

if echo "$ALL_ENABLED" | grep -q "compute.googleapis.com"; then
    log "Compute API is enabled. Checking firewall rules..."

    FW_RULES=$(gcloud compute firewall-rules list --project="$PROJECT_ID" \
        --format="table(name,network,direction,sourceRanges,allowed,priority)" 2>/dev/null || echo "NONE")
    echo "$FW_RULES" | tee -a "$REPORT_FILE"

    # Check for 0.0.0.0/0 ingress rules
    OPEN_RULES=$(gcloud compute firewall-rules list --project="$PROJECT_ID" \
        --filter="sourceRanges=0.0.0.0/0 AND direction=INGRESS" \
        --format="value(name)" 2>/dev/null || true)

    if [[ -n "$OPEN_RULES" ]]; then
        fail "Firewall rules allowing traffic from 0.0.0.0/0 (entire internet):"
        echo "$OPEN_RULES" | while read -r rule; do
            fail "  - ${rule}"
        done
        warn "ACTION: Restrict source ranges to specific IPs where possible."
    else
        pass "No firewall rules open to the entire internet."
    fi

    # Check for SSH (22) and RDP (3389) open to internet
    RISKY_PORTS=$(gcloud compute firewall-rules list --project="$PROJECT_ID" \
        --filter="sourceRanges=0.0.0.0/0 AND (allowed.ports=22 OR allowed.ports=3389)" \
        --format="value(name)" 2>/dev/null || true)

    if [[ -n "$RISKY_PORTS" ]]; then
        fail "SSH/RDP ports open to internet:"
        echo "$RISKY_PORTS" | while read -r rule; do fail "  - ${rule}"; done
    fi
else
    log "Compute API not enabled. Skipping firewall audit."
fi

# ── Storage Bucket Audit ─────────────────────────────────────────────────────
banner "10. CLOUD STORAGE BUCKET AUDIT"

if echo "$ALL_ENABLED" | grep -q "storage"; then
    log "Checking storage buckets..."
    BUCKETS=$(gcloud storage buckets list --project="$PROJECT_ID" --format="value(name)" 2>/dev/null || echo "")

    if [[ -z "$BUCKETS" ]]; then
        log "No storage buckets found."
    else
        while IFS= read -r bucket; do
            [[ -z "$bucket" ]] && continue
            log "Bucket: ${bucket}"

            # Check public access
            BUCKET_IAM=$(gcloud storage buckets get-iam-policy "gs://${bucket}" --format=json 2>/dev/null || echo "{}")
            if echo "$BUCKET_IAM" | grep -q "allUsers\|allAuthenticatedUsers"; then
                fail "  PUBLIC ACCESS on bucket: ${bucket}"
            else
                pass "  No public access: ${bucket}"
            fi

            # Check uniform bucket-level access
            UNIFORM=$(gcloud storage buckets describe "gs://${bucket}" \
                --format="value(iamConfiguration.uniformBucketLevelAccess.enabled)" 2>/dev/null || echo "unknown")
            if [[ "$UNIFORM" == "True" ]]; then
                pass "  Uniform bucket-level access enabled: ${bucket}"
            else
                warn "  Uniform bucket-level access NOT enabled: ${bucket}"
            fi
        done <<< "$BUCKETS"
    fi
else
    log "Storage API not explicitly listed. Skipping bucket audit."
fi

# ── Security Command Center ─────────────────────────────────────────────────
banner "11. SECURITY COMMAND CENTER"

SCC_STATUS=$(gcloud services list --enabled --filter="config.name=securitycenter.googleapis.com" \
    --format="value(config.name)" --project="$PROJECT_ID" 2>/dev/null || echo "")

if [[ -n "$SCC_STATUS" ]]; then
    pass "Security Command Center API is enabled."
    log "Checking for active findings..."
    gcloud scc findings list "projects/${PROJECT_ID}" \
        --filter="state=\"ACTIVE\"" \
        --format="table(finding.category,finding.severity,finding.resourceName)" \
        --limit=20 2>/dev/null | tee -a "$REPORT_FILE" || \
        warn "Could not list SCC findings. May need Organization-level access."
else
    warn "Security Command Center API not enabled."
    if confirm "Enable Security Command Center API?"; then
        gcloud services enable securitycenter.googleapis.com --project="$PROJECT_ID" 2>/dev/null && \
            pass "SCC API enabled. Configure in Console for full functionality." || \
            fail "Failed to enable SCC."
    fi
fi

# ── Budget Alerts ────────────────────────────────────────────────────────────
banner "12. BILLING & BUDGET ALERTS"

BILLING_ACCOUNT=$(gcloud billing projects describe "$PROJECT_ID" --format="value(billingAccountName)" 2>/dev/null || echo "UNKNOWN")
log "Billing account: ${BILLING_ACCOUNT}"

if [[ "$BILLING_ACCOUNT" == "UNKNOWN" || -z "$BILLING_ACCOUNT" ]]; then
    warn "Could not determine billing account. Check permissions."
else
    BILLING_ID=$(echo "$BILLING_ACCOUNT" | sed 's|billingAccounts/||')
    log "Listing existing budgets..."
    BUDGETS=$(gcloud billing budgets list --billing-account="$BILLING_ID" --format="table(name,displayName,amount)" 2>/dev/null || echo "UNAVAILABLE")

    if [[ "$BUDGETS" == "UNAVAILABLE" ]]; then
        warn "Could not list budgets. May need Billing Admin role."
        warn "ACTION: Set up budget alerts at https://console.cloud.google.com/billing/${BILLING_ID}/budgets"
    else
        echo "$BUDGETS" | tee -a "$REPORT_FILE"
        BUDGET_COUNT=$(echo "$BUDGETS" | tail -n +2 | grep -c "." || true)

        if [[ "$BUDGET_COUNT" -eq 0 ]]; then
            fail "No budget alerts configured! This is a billing fraud risk."
            warn "ACTION: Create a budget at https://console.cloud.google.com/billing/${BILLING_ID}/budgets"
        else
            pass "Budget alerts exist: ${BUDGET_COUNT}"
        fi
    fi
fi

# ── Org Policy Checks (if available) ────────────────────────────────────────
banner "13. ORGANIZATION POLICY CHECKS"

ORG_ID=$(gcloud organizations list --format="value(name)" 2>/dev/null | head -1 || echo "")

if [[ -z "$ORG_ID" ]]; then
    warn "No organization access detected. Project may be standalone."
    warn "RECOMMENDATION: Move project under a Google Cloud Organization for better policy controls."
    warn "  - Enforce MFA at the org level"
    warn "  - Set domain-restricted sharing"
    warn "  - Enforce uniform bucket-level access"
    warn "  - Restrict VM external IPs"
else
    log "Organization: ${ORG_ID}"

    # Check key org policies
    POLICIES_TO_CHECK=(
        "constraints/iam.allowedPolicyMemberDomains"
        "constraints/iam.disableServiceAccountKeyCreation"
        "constraints/compute.requireOsLogin"
        "constraints/compute.disableSerialPortAccess"
        "constraints/compute.restrictVpcPeering"
        "constraints/storage.uniformBucketLevelAccess"
        "constraints/sql.restrictPublicIp"
    )

    for policy in "${POLICIES_TO_CHECK[@]}"; do
        RESULT=$(gcloud resource-manager org-policies describe "$policy" \
            --project="$PROJECT_ID" --format="value(booleanPolicy,listPolicy)" 2>/dev/null || echo "NOT_SET")
        if [[ "$RESULT" == "NOT_SET" || -z "$RESULT" ]]; then
            warn "Org policy not set: ${policy}"
        else
            pass "Org policy active: ${policy}"
        fi
    done
fi

# ── Network Security ────────────────────────────────────────────────────────
banner "14. NETWORK SECURITY"

if echo "$ALL_ENABLED" | grep -q "compute.googleapis.com"; then
    # Check for VMs with external IPs
    log "Checking for VMs with external IPs..."
    EXTERNAL_VMS=$(gcloud compute instances list --project="$PROJECT_ID" \
        --format="table(name,zone,networkInterfaces[].accessConfigs[].natIP)" 2>/dev/null || echo "NONE")
    echo "$EXTERNAL_VMS" | tee -a "$REPORT_FILE"

    # Check for default network
    DEFAULT_NET=$(gcloud compute networks list --project="$PROJECT_ID" \
        --filter="name=default" --format="value(name)" 2>/dev/null || echo "")
    if [[ -n "$DEFAULT_NET" ]]; then
        warn "Default network exists. Consider deleting it and using custom VPCs."
    else
        pass "No default network (good practice)."
    fi
fi

# ── Disable Unused APIs ─────────────────────────────────────────────────────
banner "15. DISABLE UNUSED APIs"

warn "Review the enabled API list above. Disable any APIs you do not use."
warn "Each enabled API is an attack surface."

COMMONLY_UNUSED=(
    "deploymentmanager.googleapis.com"
    "sourcerepo.googleapis.com"
    "dataflow.googleapis.com"
    "dataproc.googleapis.com"
    "composer.googleapis.com"
    "genomics.googleapis.com"
    "tpu.googleapis.com"
)

for api in "${COMMONLY_UNUSED[@]}"; do
    if echo "$ALL_ENABLED" | grep -q "^${api}$"; then
        if confirm "Disable potentially unused API: ${api}?"; then
            gcloud services disable "$api" --project="$PROJECT_ID" 2>/dev/null && \
                pass "Disabled: ${api}" || fail "Failed to disable: ${api}"
        fi
    fi
done

# ── Summary ──────────────────────────────────────────────────────────────────
banner "AUDIT COMPLETE"

log "Full report saved to: ${REPORT_FILE}"
log ""
log "CRITICAL NEXT STEPS (Manual):"
log "  1. Enable 2-Step Verification on ${OWNER_EMAIL} (Google Account settings)"
log "  2. Enroll in Google Advanced Protection Program"
log "  3. Review and restrict all API keys in Console"
log "  4. Set up budget alerts if not already done"
log "  5. Review the Security Checklist: ~/paige-v2/SECURITY-CHECKLIST.md"
log "  6. Run this script monthly to re-audit"
log ""
log "Console Security Dashboard:"
log "  https://console.cloud.google.com/security/overview?project=${PROJECT_ID}"
log ""
warn "Remember: Security is continuous. Automate this script with cron for monthly checks."

echo ""
echo -e "${GREEN}Done. Report: ${REPORT_FILE}${NC}"
