---
layout: post
title: "Secure AKS Ingress using Application Gateway and Let's Encrypt"
date: 2026-03-08
categories: [Azure, Kubernetes, DevOps]
tags: [AKS, AGIC, cert-manager, LetsEncrypt]
---

# Secure AKS Ingress using Application Gateway and Let's Encrypt

## Introduction

When deploying applications in Azure Kubernetes Service (AKS), exposing them securely is essential.

In this tutorial we will configure:

- Application Gateway Ingress Controller
- Kubernetes Ingress
- cert-manager
- Let's Encrypt TLS certificates

  ## Prerequisites

Before starting this tutorial, ensure the following requirement is already met.

- An **Azure Kubernetes Service (AKS) cluster is already created and running**
- You have access to the **Azure Portal**
- `kubectl` is configured to access the AKS cluster
- A domain name (optional, required later for HTTPS configuration)

You can verify that your AKS cluster is accessible by running:

```bash
kubectl get nodes

Step 1 — Enable Application Gateway Ingress Controller

The first step is to enable the Application Gateway Ingress Controller (AGIC) for the AKS cluster.

This can be done directly from the Azure Portal.

Steps

Navigate to the Azure Portal.

Open your AKS Cluster.

In the left menu, select Networking.

Inside the Networking section, locate Application Gateway Ingress.

Click Enable Application Gateway Ingress.

Once enabled, Azure will automatically deploy the Application Gateway Ingress Controller (AGIC) into the Kubernetes cluster.

This controller allows Azure Application Gateway to act as an ingress controller for Kubernetes workloads.
