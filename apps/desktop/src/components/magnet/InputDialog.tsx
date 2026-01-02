import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n';
import './InputDialog.css';

interface InputDialogProps {
  isOpen: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export const InputDialog: React.FC<InputDialogProps> = ({
  isOpen,
  title,
  message,
  placeholder = '',
  defaultValue = '',
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
}) => {
  const t = useT();
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const resolvedConfirmText = confirmText === undefined ? t('common.action.confirm') : confirmText;
  const resolvedCancelText = cancelText === undefined ? t('common.action.cancel') : cancelText;

  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue);
      // 延迟聚焦以确保对话框已渲染
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }, [isOpen, defaultValue]);

  if (!isOpen) return null;

  const handleConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (value.trim()) {
      onConfirm(value.trim());
    }
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      onConfirm(value.trim());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return createPortal(
    <div className="input-dialog-overlay" onClick={handleCancel}>
      <div className="input-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="input-dialog-header">
          <h3 className="input-dialog-title">{title}</h3>
        </div>
        <div className="input-dialog-body">
          {message && <p className="input-dialog-message">{message}</p>}
          <input
            ref={inputRef}
            type="text"
            className="input-dialog-input"
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="input-dialog-footer">
          <button className="input-dialog-btn input-dialog-btn-cancel" onClick={handleCancel}>
            {resolvedCancelText}
          </button>
          <button
            className="input-dialog-btn input-dialog-btn-confirm"
            onClick={handleConfirm}
            disabled={!value.trim()}
          >
            {resolvedConfirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
