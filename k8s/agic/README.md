# AGIC Manifests

This folder adds an Azure Application Gateway Ingress Controller path for PipelineIQ
without removing the current `kgateway` setup.

## What this does

- Reuses the existing `pipelineiq` namespace and Services
- Maps the same public routes currently used by the application:
  - `/` -> `frontend:80`
  - `/api` -> `dashboard-api:8080`
  - `/api/auth` -> `auth-service:8081`
  - `/api/webhooks/github` -> `webhook-service:8087`

## What this does not do

- It does not delete `k8s/kgateway`
- It does not modify Deployments or Secrets
- It does not change the active public IP until you deploy AGIC and point traffic to
  the Application Gateway frontend

## Safe rollout order

1. Keep the current gateway path running.
2. Install AGIC in AKS as an add-on or Helm deployment.
3. Apply this folder:

   ```bash
   kubectl apply -k k8s/agic
   ```

4. Confirm the Ingress is accepted:

   ```bash
   kubectl get ingress -n pipelineiq
   kubectl describe ingress pipelineiq-agic -n pipelineiq
   ```

5. In Azure, verify the Application Gateway listener, backend pools, and rules are
   created by AGIC.
6. After the Application Gateway public IP is ready, update:
   - `FRONTEND_URL`
   - `PUBLIC_API_BASE_URL`
   - `PUBLIC_AUTH_BASE_URL`
   - `GITHUB_CALLBACK_URL`
   - GitHub OAuth app callback URL
   - GitHub webhook URL, if needed
7. Test login, repo loading, workflow dispatch, and webhook callbacks.
8. Only after validation, remove the old gateway exposure path.

## Notes

- AGIC can take ownership of an Application Gateway. Use a dedicated Application
  Gateway for PipelineIQ unless you intentionally configure a shared model.
- If you later fully cut over to AGIC, remove the old `kgateway` manifests from your
  operational apply flow, not before validation.
