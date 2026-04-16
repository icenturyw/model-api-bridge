export async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (response.status === 204) {
    return null;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || payload.error || payload.detail || "Request failed");
  }

  return payload.data ?? payload;
}

export function jsonBody(value) {
  return JSON.stringify(value);
}

export function boolValue(form, name) {
  return form.elements[name]?.checked ?? false;
}

export function numberValue(form, name) {
  const value = form.elements[name]?.value;
  if (value === "" || value === undefined) {
    return undefined;
  }
  return Number(value);
}
