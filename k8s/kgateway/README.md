# kgateway Deployment

This folder is the active external routing setup for PipelineIQ.

PipelineIQ now uses `kgateway` and Kubernetes Gateway API as the single north-south traffic path.
Apply these resources only after `kgateway` is installed in the cluster.

## What is here

- `namespace.yaml`
  - Dedicated namespace for the kgateway control plane
- `gateway.yaml`
  - The Gateway API entry point for PipelineIQ
- `gateway-service.yaml`
  - Repo-managed LoadBalancer service override for the gateway, including the public IP to reuse
- `frontend-route.yaml`
  - Routes `/` to the frontend service
- `auth-route.yaml`
  - Routes `/api/auth` to the auth service
- `dashboard-route.yaml`
  - Routes `/api` to the dashboard API
- `webhook-route.yaml`
  - Routes `/api/webhooks/github` to the webhook service
- `kustomization.yaml`
  - Lets you apply the whole folder together

## Deployment order

1. Install `kgateway` in AKS first.
2. Confirm a `GatewayClass` named `kgateway` exists:

   ```bash
   kubectl get gatewayclass
   ```

3. Apply these route resources:

   ```bash
   kubectl apply -f k8s/kgateway/
   ```

4. Check the new gateway:

   ```bash
   kubectl get gateway -n pipelineiq
   kubectl get httproute -n pipelineiq
   ```

5. Apply the repo-managed gateway service override and wait for the public IP:

   ```bash
   kubectl apply -k k8s/kgateway
   kubectl get svc pipelineiq-gateway -n pipelineiq -w
   ```
6. Update GitHub OAuth callback URL only after the gateway IP or DNS is confirmed.

## Important notes

- `gatewayClassName: kgateway` assumes the installed controller exposes that class name.
  If your installed class name is different, update `gateway.yaml`.
- These resources intentionally do not set `hostnames`, so you can test with an IP first.
- These manifests are intended to replace the old NGINX ingress path.
- If you need to reuse a different Azure public IP, update `loadBalancerIP` in `gateway-service.yaml`.

## Validation checklist

After the kgateway public IP or DNS is ready:

1. Update:
   - `FRONTEND_URL`
   - `PUBLIC_API_BASE_URL`
   - `PUBLIC_AUTH_BASE_URL`
   - `GITHUB_CALLBACK_URL`
2. Restart the affected deployments:

   ```bash
   kubectl rollout restart deployment/frontend -n pipelineiq
   kubectl rollout restart deployment/auth-service -n pipelineiq
   kubectl rollout restart deployment/dashboard-api -n pipelineiq
   ```

3. In GitHub OAuth App set:
   - Homepage URL: `http://<kgateway-ip-or-domain>`
   - Callback URL: `http://<kgateway-ip-or-domain>/api/auth/github/callback`
4. Test:
   - app loads
   - login works
   - repo fetch works
   - pipeline trigger works
   - failure analysis works
5. Remove the old ingress object:

   ```bash
   kubectl delete ingress pipelineiq-ingress -n pipelineiq --ignore-not-found
   ```

6. If you are fully done with NGINX ingress, remove the controller namespace too:

   ```bash
   kubectl delete namespace ingress-nginx --ignore-not-found
   ```
