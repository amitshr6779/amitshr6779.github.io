

# EFK Stack on AKS — Production Ready Setup

A complete guide to deploying **Elasticsearch, Fluent Bit, and Kibana** on Azure Kubernetes Service for centralized logging.

---

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Cluster Setup](#cluster-setup)
- [Deploy Elasticsearch (ECK)](#deploy-elasticsearch-eck)
- [Deploy Kibana](#deploy-kibana)
- [Deploy Fluent Bit](#deploy-fluent-bit)
- [Azure Blob Archival](#azure-blob-archival)
- [Index Lifecycle Management (ILM)](#index-lifecycle-management-ilm)
- [Kibana Dashboards](#kibana-dashboards)
- [KQL Queries Reference](#kql-queries-reference)
- [Elasticsearch Dev Tools Queries](#elasticsearch-dev-tools-queries)
- [Security](#security)
- [Scaling & HA](#scaling--ha)
- [Monitoring the Stack](#monitoring-the-stack)
- [Troubleshooting](#troubleshooting)
- [Cost Optimization](#cost-optimization)
- [Useful Commands](#useful-commands)

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    AKS Cluster                       │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ App Pods  │  │ App Pods  │  │ App Pods  │          │
│  │ (stdout)  │  │ (stdout)  │  │ (stdout)  │          │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘         │
│        └───────────────┼───────────────┘              │
│                        ▼                              │
│         ┌──────────────────────────┐                 │
│         │  Fluent Bit (DaemonSet)  │                 │
│         │  /var/log/containers/*   │                 │
│         └──────────┬───────┬───────┘                 │
│                    │       │                          │
│                    ▼       ▼                          │
│  ┌─────────────────────┐  ┌──────────────────┐      │
│  │   Elasticsearch     │  │  Azure Blob      │      │
│  │   (StatefulSet)     │  │  (archive)       │      │
│  │   master + data     │  └──────────────────┘      │
│  └──────────┬──────────┘                             │
│             ▼                                        │
│  ┌─────────────────────┐                             │
│  │   Kibana            │                             │
│  │   (Deployment)      │                             │
│  └─────────────────────┘                             │
└──────────────────────────────────────────────────────┘
```

### Key Concepts

| Component | K8s Resource | Purpose |
|-----------|-------------|---------|
| ECK Operator | Deployment | Manages ES & Kibana lifecycle automatically |
| ECK CRDs | Custom Resource Definitions | Teaches K8s what `Elasticsearch` and `Kibana` resources are |
| Elasticsearch Master | StatefulSet (via ECK) | Cluster brain — tracks metadata, allocates shards. Always 3 for quorum |
| Elasticsearch Data | StatefulSet (via ECK) | Stores and searches actual logs. Scale as needed |
| Fluent Bit | DaemonSet (via Helm) | Lightweight log collector — one per node |
| Kibana | Deployment (via ECK) | Web UI for searching and visualizing logs |

> **Note**: ES master/data nodes are pods on your AKS worker nodes. They are NOT related to AKS control plane master nodes (which are Azure-managed and invisible).

### What Needs Persistent Storage?

| Component | PV Required? | Reason |
|-----------|-------------|--------|
| Elasticsearch | Yes | Stores log data — must survive pod restarts |
| Fluent Bit | No | Stateless — reads and forwards logs |
| Kibana | No | Stateless — just a UI querying Elasticsearch |

---

## Prerequisites

```bash
# Azure CLI
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

# kubectl
az aks install-cli

# Helm 3
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

---

## Cluster Setup

### Create AKS Cluster

```bash
RESOURCE_GROUP="rg-efk-prod"
CLUSTER_NAME="aks-efk-cluster"
LOCATION="centralindia"

az group create --name $RESOURCE_GROUP --location $LOCATION

az aks create \
  --resource-group $RESOURCE_GROUP \
  --name $CLUSTER_NAME \
  --node-count 3 \
  --node-vm-size Standard_D4s_v3 \
  --enable-managed-identity \
  --network-plugin azure \
  --network-policy calico \
  --generate-ssh-keys \
  --zones 1 2 3

az aks get-credentials --resource-group $RESOURCE_GROUP --name $CLUSTER_NAME
```

### Create Dedicated Node Pool for Elasticsearch

```bash
az aks nodepool add \
  --resource-group $RESOURCE_GROUP \
  --cluster-name $CLUSTER_NAME \
  --name espooldata \
  --node-count 3 \
  --node-vm-size Standard_E4s_v3 \
  --labels role=elasticsearch-data \
  --node-taints elasticsearch=true:NoSchedule \
  --zones 1 2 3
```

> **Taint** keeps non-ES pods out. **Toleration** (in ES spec) lets ES pods in. **nodeSelector** forces ES pods to only run here.

### Create Namespace

```bash
kubectl create namespace logging
```

---

## Deploy Elasticsearch (ECK)

### Install ECK Operator

```bash
# CRDs — teach K8s new resource types
kubectl create -f https://download.elastic.co/downloads/eck/2.14.0/crds.yaml

# Operator — the specialist that manages ES & Kibana
kubectl apply -f https://download.elastic.co/downloads/eck/2.14.0/operator.yaml

kubectl -n elastic-system get pods
```

### Elasticsearch Resource

```yaml
# elasticsearch.yaml
apiVersion: elasticsearch.k8s.elastic.co/v1
kind: Elasticsearch
metadata:
  name: efk-cluster
  namespace: logging
spec:
  version: 8.15.0
  nodeSets:
    # --- Master Nodes (cluster brain, no data) ---
    - name: master
      count: 3
      config:
        node.roles: ["master"]
        node.store.allow_mmap: false
      podTemplate:
        spec:
          containers:
            - name: elasticsearch
              resources:
                requests:
                  memory: 2Gi
                  cpu: 500m
                limits:
                  memory: 4Gi
                  cpu: 2
              env:
                - name: ES_JAVA_OPTS
                  value: "-Xms2g -Xmx2g"
          initContainers:
            - name: sysctl
              securityContext:
                privileged: true
                runAsUser: 0
              command: ['sh', '-c', 'sysctl -w vm.max_map_count=262144']
          tolerations:
            - key: "elasticsearch"
              operator: "Equal"
              value: "true"
              effect: "NoSchedule"
          nodeSelector:
            role: elasticsearch-data
      volumeClaimTemplates:
        - metadata:
            name: elasticsearch-data
          spec:
            accessModes: ["ReadWriteOnce"]
            storageClassName: managed-premium
            resources:
              requests:
                storage: 10Gi

    # --- Data Nodes (stores and searches logs) ---
    - name: data
      count: 3
      config:
        node.roles: ["data", "ingest"]
        node.store.allow_mmap: false
      podTemplate:
        spec:
          containers:
            - name: elasticsearch
              resources:
                requests:
                  memory: 4Gi
                  cpu: 2
                limits:
                  memory: 8Gi
                  cpu: 4
              env:
                - name: ES_JAVA_OPTS
                  value: "-Xms4g -Xmx4g"
          tolerations:
            - key: "elasticsearch"
              operator: "Equal"
              value: "true"
              effect: "NoSchedule"
          nodeSelector:
            role: elasticsearch-data
      volumeClaimTemplates:
        - metadata:
            name: elasticsearch-data
          spec:
            accessModes: ["ReadWriteOnce"]
            storageClassName: managed-premium
            resources:
              requests:
                storage: 100Gi
```

> **For dev/demo** (2 CPU / 8GB): Use a single nodeSet with `count: 1`, combined roles, `managed` storageClass, and reduced resources. See [Cost Optimization](#cost-optimization).

```bash
kubectl apply -f elasticsearch.yaml
kubectl -n logging get elasticsearch
kubectl -n logging get pods -l elasticsearch.k8s.elastic.co/cluster-name=efk-cluster
```

### Get Credentials

```bash
# Username is always: elastic
# Password:
kubectl -n logging get secret efk-cluster-es-elastic-user -o jsonpath='{.data.elastic}' | base64 -d
```

### Verify

```bash
kubectl -n logging port-forward svc/efk-cluster-es-http 9200
curl -k -u "elastic:<password>" https://localhost:9200/_cluster/health?pretty
```

---

## Deploy Kibana

```yaml
# kibana.yaml
apiVersion: kibana.k8s.elastic.co/v1
kind: Kibana
metadata:
  name: efk-kibana
  namespace: logging
spec:
  version: 8.15.0
  count: 2
  elasticsearchRef:
    name: efk-cluster    # ECK auto-injects ES credentials
  podTemplate:
    spec:
      containers:
        - name: kibana
          resources:
            requests:
              memory: 768Mi
              cpu: 200m
            limits:
              memory: 1Gi
              cpu: 500m
          env:
            - name: NODE_OPTIONS
              value: "--max-old-space-size=768"    # prevents JS heap OOM
```

```bash
kubectl apply -f kibana.yaml
kubectl -n logging port-forward svc/efk-kibana-kb-http 5601
# Open https://localhost:5601 → login with elastic/<password>
```

### Expose via Ingress (Production)

```yaml
# kibana-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: kibana-ingress
  namespace: logging
  annotations:
    nginx.ingress.kubernetes.io/backend-protocol: "HTTPS"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - kibana.yourdomain.com
      secretName: kibana-tls
  rules:
    - host: kibana.yourdomain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: efk-kibana-kb-http
                port:
                  number: 5601
```

---

## Deploy Fluent Bit

```yaml
# fluent-bit-values.yaml
image:
  repository: fluent/fluent-bit
  tag: "3.1"

daemonSetVolumes:
  - name: varlog
    hostPath:
      path: /var/log
  - name: varlibdockercontainers
    hostPath:
      path: /var/lib/docker/containers

daemonSetVolumeMounts:
  - name: varlog
    mountPath: /var/log
  - name: varlibdockercontainers
    mountPath: /var/lib/docker/containers
    readOnly: true

config:
  service: |
    [SERVICE]
        Flush         5              # send logs every 5 seconds
        Log_Level     info
        Daemon        off
        Parsers_File  /fluent-bit/etc/parsers.conf
        HTTP_Server   On             # metrics endpoint
        HTTP_Listen   0.0.0.0
        HTTP_Port     2020
        Health_Check  On

  inputs: |
    [INPUT]
        Name              tail                           # tail log files
        Tag               kube.*
        Path              /var/log/containers/*.log      # all container logs
        Parser            cri                            # AKS uses CRI format
        DB                /var/log/flb_kube.db           # tracks read position
        Mem_Buf_Limit     50MB                           # prevents OOM
        Skip_Long_Lines   On
        Refresh_Interval  10
        Read_from_Head    False

    [INPUT]
        Name              systemd
        Tag               node.systemd.*
        Systemd_Filter    _SYSTEMD_UNIT=kubelet.service
        Read_From_Tail    On

  filters: |
    [FILTER]
        Name                kubernetes          # enrich with K8s metadata
        Match               kube.*
        Kube_URL            https://kubernetes.default.svc:443
        Kube_CA_File        /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
        Kube_Token_File     /var/run/secrets/kubernetes.io/serviceaccount/token
        Kube_Tag_Prefix     kube.var.log.containers.
        Merge_Log           On                  # parse JSON logs automatically
        Merge_Log_Key       log_processed
        K8S-Logging.Parser  On
        K8S-Logging.Exclude On
        Labels              On
        Annotations         Off
        Buffer_Size         0

    [FILTER]
        Name          modify
        Match         kube.*
        Add           cluster aks-efk-cluster   # tag with cluster name
        Add           environment production

    [FILTER]
        Name          nest
        Match         kube.*
        Operation     lift
        Nested_under  kubernetes                # flatten nested fields

  outputs: |
    [OUTPUT]
        Name            es
        Match           kube.*
        Host            efk-cluster-es-http.logging.svc.cluster.local
        Port            9200
        HTTP_User       elastic
        HTTP_Passwd     ${ES_PASSWORD}
        Logstash_Format On                      # creates daily indices
        Logstash_Prefix k8s-logs                # index: k8s-logs-2026.03.24
        Suppress_Type_Name On
        tls             On
        tls.verify      Off
        Retry_Limit     5
        Replace_Dots    On
        Buffer_Size     512KB

    [OUTPUT]
        Name            es
        Match           node.systemd.*
        Host            efk-cluster-es-http.logging.svc.cluster.local
        Port            9200
        HTTP_User       elastic
        HTTP_Passwd     ${ES_PASSWORD}
        Logstash_Format On
        Logstash_Prefix node-logs               # separate index for node logs
        Suppress_Type_Name On
        tls             On
        tls.verify      Off

  customParsers: |
    [PARSER]
        Name        cri
        Format      regex
        Regex       ^(?<time>[^ ]+) (?<stream>stdout|stderr) (?<logtag>[^ ]*) (?<message>.*)$
        Time_Key    time
        Time_Format %Y-%m-%dT%H:%M:%S.%L%z

    [PARSER]
        Name        json
        Format      json
        Time_Key    time
        Time_Format %Y-%m-%dT%H:%M:%S.%L
        Time_Keep   On

    [PARSER]
        Name        docker
        Format      json
        Time_Key    time
        Time_Format %Y-%m-%dT%H:%M:%S.%L
        Time_Keep   On

env:
  - name: ES_PASSWORD
    valueFrom:
      secretKeyRef:
        name: efk-cluster-es-elastic-user
        key: elastic

resources:
  limits:
    cpu: 200m
    memory: 256Mi
  requests:
    cpu: 100m
    memory: 128Mi

tolerations:
  - operator: Exists    # run on ALL nodes

serviceMonitor:
  enabled: true
```

```bash
helm repo add fluent https://fluent.github.io/helm-charts
helm repo update

helm install fluent-bit fluent/fluent-bit \
  --namespace logging \
  -f fluent-bit-values.yaml

kubectl -n logging get pods -l app.kubernetes.io/name=fluent-bit
kubectl -n logging logs -l app.kubernetes.io/name=fluent-bit --tail=20
```

---

## Azure Blob Archival

Send logs to both Elasticsearch (short-term search) and Azure Blob (long-term archive).

```
Fluent Bit ──▶ Elasticsearch (last 90 days, searchable in Kibana)
     │
     └──────▶ Azure Blob (forever, cheap, manual access only)
```

> Kibana CANNOT read from Blob directly. To search archived logs, re-ingest them into ES temporarily.

### Setup

```bash
# Create storage account
az storage account create \
  --name efklogsarchive \
  --resource-group $RESOURCE_GROUP \
  --location centralindia \
  --sku Standard_LRS

# Create container
az storage container create --name logs-archive --account-name efklogsarchive

# Store key as K8s secret (no copy-paste errors)
az storage account keys list --account-name efklogsarchive --query "[0].value" -o tsv | \
  xargs -I {} kubectl -n logging create secret generic azure-blob-secret \
  --from-literal=shared_key={}
```

### Add to Fluent Bit Config

```yaml
# Add to env section
env:
  - name: AZURE_BLOB_KEY
    valueFrom:
      secretKeyRef:
        name: azure-blob-secret
        key: shared_key

# Add to outputs section (alongside existing ES output)
outputs: |
    # ... existing ES outputs ...

    [OUTPUT]
        Name              azure_blob
        Match             kube.*
        account_name      efklogsarchive
        shared_key        ${AZURE_BLOB_KEY}
        container_name    logs-archive
        path              year=%Y/month=%m/day=%d
        auto_create_container  On
        blob_type         blockblob
        Retry_Limit       3
```

```bash
helm upgrade fluent-bit fluent/fluent-bit --namespace logging -f fluent-bit-values.yaml

# Verify
az storage blob list --account-name efklogsarchive --container-name logs-archive --output table
```

---

## Index Lifecycle Management (ILM)

Prevents disk from filling up by auto-managing index lifecycle.

Run in **Kibana Dev Tools**:

### Create ILM Policy

```json
PUT _ilm/policy/k8s-logs-policy
{
  "policy": {
    "phases": {
      "hot": {
        "min_age": "0ms",
        "actions": {
          "rollover": {
            "max_age": "1d",
            "max_primary_shard_size": "50gb"
          }
        }
      },
      "warm": {
        "min_age": "3d",
        "actions": {
          "shrink": { "number_of_shards": 1 },
          "forcemerge": { "max_num_segments": 1 }
        }
      },
      "cold": {
        "min_age": "30d",
        "actions": { "freeze": {} }
      },
      "delete": {
        "min_age": "90d",
        "actions": { "delete": {} }
      }
    }
  }
}
```

### Create Index Template

```json
PUT _index_template/k8s-logs-template
{
  "index_patterns": ["k8s-logs-*"],
  "template": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "index.lifecycle.name": "k8s-logs-policy",
      "index.lifecycle.rollover_alias": "k8s-logs"
    },
    "mappings": {
      "properties": {
        "@timestamp": { "type": "date" },
        "message": { "type": "text" },
        "level": { "type": "keyword" },
        "kubernetes.pod_name": { "type": "keyword" },
        "kubernetes.namespace_name": { "type": "keyword" },
        "kubernetes.container_name": { "type": "keyword" },
        "cluster": { "type": "keyword" },
        "environment": { "type": "keyword" }
      }
    }
  }
}
```

---

## Kibana Dashboards

### First: Create Data View

```
Stack Management → Data Views → Create
  Name:         k8s-logs
  Pattern:      k8s-logs-*
  Time field:   @timestamp
```

### Recommended Dashboard Panels

| Panel | Chart Type | Config |
|-------|-----------|--------|
| Log volume over time | Line | X: @timestamp, Y: count(), Breakdown: namespace_name.keyword |
| Error count | Metric (big number) | Filter: `stream: "stderr"` |
| Top pods by log volume | Bar vertical | X: pod_name.keyword (top 10), Y: count() |
| Logs by namespace | Pie | Slice: namespace_name.keyword |
| Logs by container image | Bar horizontal | Y: container_image.keyword (top 10), X: count() |
| Recent errors table | Table | Filter: `stream: "stderr"`, Columns: @timestamp, namespace, pod, message |

---

## KQL Queries Reference

Use in **Discover** or **Dashboard** KQL bar.

### Pod Logs

```bash
# Logs from specific pod
pod_name.keyword: "myapp-7d8f9b6c5-x2k4n"

# Logs from specific namespace
namespace_name.keyword: "production"

# Logs from specific app (by label)
labels.app.keyword: "payment-service"

# Logs from specific container
container_name.keyword: "nginx"

# Logs from specific node
host.keyword: "aks-nodepool1-12345-vmss000000"

# Logs from specific container image
container_image.keyword: "myregistry.azurecr.io/myapp:v2.1"
```

### Error Hunting

```bash
# All stderr output (most reliable for errors)
stream: "stderr"

# If apps log structured JSON with level field
level: "error" OR level: "ERROR"

# Keyword search in message
message: *timeout*
message: *connection refused*
message: *OOMKilled*
message: *CrashLoopBackOff*
message: *error*
message: *exception*
message: *failed*

# Probe failures
message: *probe failed*
```

### Combined Filters

```bash
# Errors in production namespace
namespace_name.keyword: "production" AND stream: "stderr"

# Timeout errors in specific app
labels.app.keyword: "api-gateway" AND message: *timeout*

# All errors except from noisy pods
stream: "stderr" AND NOT pod_name.keyword: "health-checker-*"

# Exclude system namespaces
NOT namespace_name.keyword: "kube-system" AND NOT namespace_name.keyword: "logging"

# Multiple namespaces
namespace_name.keyword: ("production" OR "staging")
```

### Cluster / Environment

```bash
# Specific cluster
cluster.keyword: "aks-efk-cluster"

# Specific environment
environment.keyword: "production"
```

---

## Elasticsearch Dev Tools Queries

Run in **Kibana → Dev Tools**.

### Health & Status

```json
# Cluster health
GET _cluster/health?pretty

# List all indices with sizes
GET _cat/indices?v&s=store.size:desc

# Node resource usage
GET _cat/nodes?v&h=name,heap.percent,ram.percent,cpu,load_1m,disk.used_percent

# Shard allocation
GET _cat/shards?v

# Disk allocation per node
GET _cat/allocation?v

# Check ILM policy
GET _ilm/policy/k8s-logs-policy
```

### Search Queries

```json
# Count total logs
GET k8s-logs-*/_count

# Latest 5 logs
GET k8s-logs-*/_search
{
  "size": 5,
  "sort": [{"@timestamp": "desc"}]
}

# Search for errors
GET k8s-logs-*/_search
{
  "size": 10,
  "query": {
    "match": { "stream": "stderr" }
  },
  "sort": [{"@timestamp": "desc"}]
}

# Logs from specific pod
GET k8s-logs-*/_search
{
  "size": 10,
  "query": {
    "term": { "pod_name.keyword": "myapp-xyz" }
  }
}

# Full-text search in message
GET k8s-logs-*/_search
{
  "size": 10,
  "query": {
    "match": { "message": "timeout" }
  }
}
```

### Aggregations (Analytics)

```json
# Error count per namespace
GET k8s-logs-*/_search
{
  "size": 0,
  "query": { "match": { "stream": "stderr" } },
  "aggs": {
    "by_namespace": {
      "terms": { "field": "namespace_name.keyword" }
    }
  }
}

# Top 10 pods by log volume
GET k8s-logs-*/_search
{
  "size": 0,
  "aggs": {
    "top_pods": {
      "terms": {
        "field": "pod_name.keyword",
        "size": 10
      }
    }
  }
}

# Log count per hour (histogram)
GET k8s-logs-*/_search
{
  "size": 0,
  "aggs": {
    "logs_over_time": {
      "date_histogram": {
        "field": "@timestamp",
        "calendar_interval": "hour"
      }
    }
  }
}

# Unique pod count per namespace
GET k8s-logs-*/_search
{
  "size": 0,
  "aggs": {
    "by_namespace": {
      "terms": { "field": "namespace_name.keyword" },
      "aggs": {
        "unique_pods": {
          "cardinality": { "field": "pod_name.keyword" }
        }
      }
    }
  }
}
```

### Disk Management

```json
# Emergency: relax disk watermarks
PUT _cluster/settings
{
  "transient": {
    "cluster.routing.allocation.disk.watermark.low": "90%",
    "cluster.routing.allocation.disk.watermark.high": "95%",
    "cluster.routing.allocation.disk.watermark.flood_stage": "97%"
  }
}

# Delete old indices
DELETE k8s-logs-2025.12.*

# Check index size
GET _cat/indices/k8s-logs-*?v&s=store.size:desc&h=index,store.size,docs.count
```

---

## Security

### Elasticsearch RBAC

```json
# Write-only role for Fluent Bit
POST _security/role/fluent_bit_writer
{
  "cluster": ["monitor", "manage_index_templates", "manage_ilm"],
  "indices": [{
    "names": ["k8s-logs-*", "node-logs-*"],
    "privileges": ["create_index", "create", "write", "manage"]
  }]
}

# Read-only role for developers
POST _security/role/log_reader
{
  "indices": [{
    "names": ["k8s-logs-*"],
    "privileges": ["read", "view_index_metadata"]
  }]
}
```

### Network Policy

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: elasticsearch-allow
  namespace: logging
spec:
  podSelector:
    matchLabels:
      elasticsearch.k8s.elastic.co/cluster-name: efk-cluster
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: fluent-bit
      ports:
        - port: 9200
    - from:
        - podSelector:
            matchLabels:
              kibana.k8s.elastic.co/name: efk-kibana
      ports:
        - port: 9200
    - from:
        - podSelector:
            matchLabels:
              elasticsearch.k8s.elastic.co/cluster-name: efk-cluster
      ports:
        - port: 9300
```

---

## Scaling & HA

### Pod Disruption Budgets

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: elasticsearch-pdb
  namespace: logging
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      elasticsearch.k8s.elastic.co/cluster-name: efk-cluster
```

### Storage Classes

```yaml
# Production: Premium SSD
storageClassName: managed-premium

# Dev/Test: Standard SSD (cheaper)
storageClassName: managed

# Archive: Standard HDD (cheapest)
storageClassName: default
```

### Volume Expansion (when disk fills up)

```bash
# StorageClass must have: allowVolumeExpansion: true
kubectl -n logging patch pvc elasticsearch-data-efk-cluster-es-data-0 \
  -p '{"spec":{"resources":{"requests":{"storage":"200Gi"}}}}'
```

---

## Monitoring the Stack

### Key Metrics

| Metric | Alert Threshold |
|--------|----------------|
| Fluent Bit output errors | Any increase |
| Fluent Bit retry count | > 0 sustained |
| ES cluster health | Yellow = warning, Red = critical |
| ES JVM heap usage | > 85% |
| ES disk usage | > 80% |

### Fluent Bit Metrics

```bash
kubectl -n logging exec -it <fb-pod> -- curl http://localhost:2020/api/v1/metrics
kubectl -n logging exec -it <fb-pod> -- curl http://localhost:2020/api/v1/health
```

---

## Troubleshooting

### Fluent Bit not sending logs

```bash
kubectl -n logging logs -l app.kubernetes.io/name=fluent-bit --tail=50
kubectl -n logging exec -it <fb-pod> -- curl -k https://efk-cluster-es-http:9200
```

### Pod won't schedule (Insufficient CPU)

```bash
kubectl describe node <node-name> | grep -A 5 "Allocated resources"
# Fix: Lower resource requests or scale up node
```

### Kibana OOM (JavaScript heap out of memory)

```yaml
env:
  - name: NODE_OPTIONS
    value: "--max-old-space-size=768"
```

### Elasticsearch disk full

```bash
# Check disk
curl -k -u elastic:<pass> "https://localhost:9200/_cat/allocation?v"
# Delete old indices or expand PVC
```

### No `level` field in Kibana

Use `stream: "stderr"` instead. The `level` field only appears when apps log structured JSON with a level key.

---

## Cost Optimization

### Resource Sizing

| Environment | ES Spec | Kibana Spec | Storage |
|-------------|---------|-------------|---------|
| Dev/Demo (2 CPU/8GB) | 1 pod, 200m CPU, 1.5Gi mem | 1 pod, 50m CPU, 512Mi mem | 5-10Gi `managed` |
| Production Small | 3+3 pods, 500m CPU, 4Gi mem | 2 pods, 200m CPU, 1Gi mem | 100Gi `managed-premium` |
| Production Large | 3+6 pods, 2 CPU, 8Gi mem | 3 pods, 500m CPU, 2Gi mem | 500Gi+ `managed-premium` |

### Reduce Log Volume

```ini
# Drop debug logs
[FILTER]
    Name    grep
    Match   kube.*
    Exclude log level=debug

# Drop health check logs
[FILTER]
    Name    grep
    Match   kube.*
    Exclude log GET /healthz
```

---

## Useful Commands

```bash
# ── Elasticsearch ──
kubectl -n logging get elasticsearch                         # cluster status
kubectl -n logging get pods -l elasticsearch.k8s.elastic.co/cluster-name=efk-cluster
curl -k -u elastic:<pass> "https://localhost:9200/_cluster/health?pretty"
curl -k -u elastic:<pass> "https://localhost:9200/_cat/indices?v&s=store.size:desc"
curl -k -u elastic:<pass> "https://localhost:9200/_cat/nodes?v&h=name,heap.percent,ram.percent,cpu,disk.used_percent"

# ── Kibana ──
kubectl -n logging get kibana
kubectl -n logging port-forward svc/efk-kibana-kb-http 5601

# ── Fluent Bit ──
kubectl -n logging get pods -l app.kubernetes.io/name=fluent-bit
kubectl -n logging logs -l app.kubernetes.io/name=fluent-bit --tail=20
kubectl -n logging exec -it <fb-pod> -- curl http://localhost:2020/api/v1/metrics

# ── Credentials ──
kubectl -n logging get secret efk-cluster-es-elastic-user -o jsonpath='{.data.elastic}' | base64 -d

# ── AKS ──
az aks nodepool list --resource-group $RG --cluster-name $CLUSTER -o table
kubectl describe node <node> | grep -A 5 "Allocated resources"
kubectl top pods -n logging
```

---
