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

```
h
