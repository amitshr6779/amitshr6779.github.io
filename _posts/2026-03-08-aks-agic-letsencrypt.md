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
