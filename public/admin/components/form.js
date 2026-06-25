import { escapeHtml } from '../utils.js';

export function createForm() {
  function showError(field, message) {
    const errorElement = field.parentElement.querySelector('.field-error');
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.style.display = 'block';
    }
    field.classList.add('error');
  }

  function clearError(field) {
    const errorElement = field.parentElement.querySelector('.field-error');
    if (errorElement) {
      errorElement.textContent = '';
      errorElement.style.display = 'none';
    }
    field.classList.remove('error');
  }

  function clearAllErrors(form) {
    form.querySelectorAll('.field-error').forEach(el => {
      el.textContent = '';
      el.style.display = 'none';
    });
    form.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
  }

  function validateRequired(form) {
    let isValid = true;
    form.querySelectorAll('[required]').forEach(field => {
      if (!field.value.trim()) {
        showError(field, '此字段为必填项');
        isValid = false;
      } else {
        clearError(field);
      }
    });
    return isValid;
  }

  function validateNumber(form, fieldName, min = null, max = null) {
    const field = form.elements[fieldName];
    if (!field) return true;
    
    const value = field.value;
    if (value === '') return true;
    
    const num = Number(value);
    if (isNaN(num)) {
      showError(field, '请输入有效的数字');
      return false;
    }
    
    if (min !== null && num < min) {
      showError(field, `数值不能小于 ${min}`);
      return false;
    }
    
    if (max !== null && num > max) {
      showError(field, `数值不能大于 ${max}`);
      return false;
    }
    
    clearError(field);
    return true;
  }

  function getFormData(form) {
    const data = {};
    const formData = new FormData(form);
    
    for (const [key, value] of formData.entries()) {
      if (form.elements[key]?.type === 'checkbox') {
        data[key] = form.elements[key].checked;
      } else if (form.elements[key]?.type === 'number') {
        data[key] = value === '' ? undefined : Number(value);
      } else {
        data[key] = value;
      }
    }
    
    return data;
  }

  function setLoading(form, loading) {
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = loading;
      submitButton.textContent = loading ? '提交中...' : submitButton.dataset.originalText || '保存';
    }
  }

  function initForm(form) {
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.dataset.originalText = submitButton.textContent;
    }
    
    form.addEventListener('input', (e) => {
      if (e.target.classList.contains('error')) {
        clearError(e.target);
      }
    });
  }

  return {
    showError,
    clearError,
    clearAllErrors,
    validateRequired,
    validateNumber,
    getFormData,
    setLoading,
    initForm
  };
}

export const form = createForm();