{{/* Expand the name of the chart. */}}
{{- define "omniproject.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Fully qualified app name (release-scoped, ≤63 chars). */}}
{{- define "omniproject.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/* Chart name and version label value. */}}
{{- define "omniproject.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Common labels applied to every object. */}}
{{- define "omniproject.labels" -}}
helm.sh/chart: {{ include "omniproject.chart" . }}
{{ include "omniproject.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: omniproject
{{- end -}}

{{/* Selector labels — the stable subset used by Deployments/Services. */}}
{{- define "omniproject.selectorLabels" -}}
app.kubernetes.io/name: {{ include "omniproject.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* The ServiceAccount name to use. */}}
{{- define "omniproject.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "omniproject.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* The Secret name the pod reads env from (created here, or a pre-existing one). */}}
{{- define "omniproject.secretName" -}}
{{- if .Values.secret.existingSecret -}}
{{- .Values.secret.existingSecret -}}
{{- else -}}
{{- printf "%s-secrets" (include "omniproject.fullname" .) -}}
{{- end -}}
{{- end -}}
