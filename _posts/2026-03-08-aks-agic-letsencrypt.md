---
layout: post
title: "Secure AKS Ingress using Application Gateway and Let's Encrypt"
date: 2026-03-08
categories: [Azure, Kubernetes, DevOps]
tags: [AKS, AGIC, cert-manager, LetsEncrypt]
---

# Secure AKS Ingress using Application Gateway and Let's Encrypt

## Introduction

When deploying applications in Azure Kubernetes Service (AKS), exposing
services to the internet securely is an important requirement.

Azure provides Application Gateway Ingress Controller (AGIC) which
allows Azure Application Gateway to function as an ingress controller
for Kubernetes workloads.

In this guide we will cover the complete workflow:

1.  Enable Application Gateway Ingress Controller
2.  Deploy a demo NGINX application
3.  Expose the application using Kubernetes Ingress
4.  Verify application access over HTTP
5.  Install cert-manager
6.  Configure Let's Encrypt TLS certificates
7.  Enable HTTPS for secure access

By the end of this guide, your application will be accessible securely
using HTTPS.

------------------------------------------------------------------------

# Architecture Overview

```
User
↓
DNS (test.yourdomain.com)
↓
Azure Application Gateway
↓
Application Gateway Ingress Controller (AGIC)
↓
Kubernetes Service
↓
NGINX Pod
```

For HTTPS certificate issuance:

```
cert-manager 
    ↓ 
Let's Encrypt 
    ↓
TLS Certificate 
    ↓ 
Application Gateway HTTPS Listener
```

------------------------------------------------------------------------

# Prerequisites

Before starting this tutorial ensure the following requirement is
satisfied.

-   An Azure Kubernetes Service (AKS) cluster is already created and
    running
-   You have access to Azure Portal
-   kubectl is installed and connected to the cluster
-   helm is installed
-   A domain name (required later for HTTPS)

Verify cluster connectivity:

```
kubectl get nodes
```

------------------------------------------------------------------------

# Step 1 --- Enable Application Gateway Ingress

The first step is to enable Application Gateway Ingress Controller
(AGIC).

Steps:

1.  Navigate to Azure Portal
2.  Open your AKS Cluster
3.  Select Networking
4.  Locate Application Gateway Ingress
5.  Click Enable Application Gateway Ingress

Azure will automatically deploy the AGIC controller inside the AKS
cluster.
<img width="826" height="479" alt="Screenshot from 2026-03-08 17-11-13" src="https://github.com/user-attachments/assets/a548d4ba-d7a6-45f6-846d-2732588c0b7d" />


------------------------------------------------------------------------

# Step 2 --- Verify AGIC Controller
```
kubectl get pods -n kube-system
```
Expected output:

ingress-appgw-xxxxx Running

------------------------------------------------------------------------

# Step 3 --- Deploy Demo NGINX Application

Create nginx-deployment.yaml
```
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-demo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: nginx-demo
  template:
    metadata:
      labels:
        app: nginx-demo
    spec:
      containers:
      - name: nginx
        image: nginx
        ports:
        - containerPort: 80
```
Apply:

```
kubectl apply -f nginx-deployment.yaml
```
------------------------------------------------------------------------

# Step 4 --- Create Kubernetes Service

service.yaml
```
apiVersion: v1
kind: Service
metadata:
  name: nginx-demo-service
spec:
  selector:
    app: nginx-demo
  ports:
  - port: 80
    targetPort: 80
```
Apply:

kubectl apply -f service.yaml

------------------------------------------------------------------------

# Step 5 --- Create Ingress Resource

ingress.yaml

```
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: nginx-demo-ingress
  annotations:
    kubernetes.io/ingress.class: azure/application-gateway

spec:
  rules:
  - host: test.yourdomain.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: nginx-demo-service
            port:
              number: 80
```

Apply:

kubectl apply -f ingress.yaml

------------------------------------------------------------------------

# Step 6 --- Verify Application (HTTP)

Ensure DNS points to the Application Gateway public IP.

Open:

http://test.yourdomain.com

You should see the NGINX welcome page.

------------------------------------------------------------------------

# Step 7 --- Install cert-manager
```
helm repo add jetstack https://charts.jetstack.io helm repo update

helm install cert-manager jetstack/cert-manager --namespace cert-manager
--create-namespace --set installCRDs=true
```

Verify:
```
kubectl get pods -n cert-manager
```
Expected output:
```
cert-manager
cert-manager-webhook
cert-manager-cainjector
```
------------------------------------------------------------------------

# Step 8 --- Create ClusterIssuer

cluster-issuer.yaml

```
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    email: your-email@example.com
    server: https://acme-v02.api.letsencrypt.org/directory
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: azure/application-gateway
```

Apply:

kubectl apply -f cluster-issuer.yaml

Verify:

kubectl get clusterissuer

------------------------------------------------------------------------

# Step 9 --- Enable TLS in Ingress

Add TLS configuration in ingress.

```
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: nginx-demo-ingress
  annotations:
    kubernetes.io/ingress.class: azure/application-gateway
    cert-manager.io/cluster-issuer: letsencrypt-prod
    acme.cert-manager.io/http01-edit-in-place: "true"
    appgw.ingress.kubernetes.io/ssl-redirect: "true"

spec:
  tls:
  - hosts:
    - test.yourdomain.com
    secretName: test.yourdomain.com-tls

  rules:
  - host: test.yourdomain.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: nginx-demo-service
            port:
              number: 80
```

------------------------------------------------------------------------

# Step 10 --- Verify Certificate
```
kubectl get certificate
```
Expected:

test.yourdomain.com-tls True

Check secret:
```
kubectl get secret test.yourdomain.com-tls
```
------------------------------------------------------------------------

# Step 11 --- Verify HTTPS

Open browser:

https://test.yourdomain.com

You should see a secure connection.

Certificate issued by:

Let's Encrypt

# Troubleshooting
## Certificate not issued

Check:
```
kubectl get challenge
kubectl get orders
kubectl describe certificate
```
## DNS issues

Ensure domain points to Application Gateway IP.

nslookup test.yourdomain.com
## AGIC issues

Check logs:
```
kubectl logs -n kube-system deploy/ingress-appgw
```
------------------------------------------------------------------------

# Conclusion

In this guide we:

-   Enabled Application Gateway Ingress Controller
-   Deployed an NGINX application
-   Exposed it using Ingress
-   Verified HTTP access
-   Installed cert-manager
-   Configured Let's Encrypt
-   Enabled HTTPS for secure access

This setup provides automated TLS certificate management for
applications running in AKS.
