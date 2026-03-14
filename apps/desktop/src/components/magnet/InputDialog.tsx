import React, { useState, useEffect, useRef } from 'react';
import { useT } from '../../i18n';
import { PmpButton, PmpDialog } from '../primitives';
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
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }, [isOpen, defaultValue]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (value.trim()) {
      onConfirm(value.trim());
    }
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

  return (
    <PmpDialog
      open={isOpen}
      title={title}
      overlaySurfaceId="overlay.modal"
      dialogSurfaceId="primitive.dialog.default"
      overlayClassName="input-dialog-overlay"
      className="input-dialog"
      headerClassName="input-dialog-header"
      titleClassName="input-dialog-title"
      bodyClassName="input-dialog-body"
      footerClassName="input-dialog-footer"
      onClose={onCancel}
      footer={
        <>
          <PmpButton className="input-dialog-btn input-dialog-btn-cancel" variant="ghost" onClick={onCancel}>
            {resolvedCancelText}
          </PmpButton>
          <PmpButton
            className="input-dialog-btn input-dialog-btn-confirm"
            variant="primary"
            onClick={handleConfirm}
            disabled={!value.trim()}
          >
            {resolvedConfirmText}
          </PmpButton>
        </>
      }
    >
      {message ? <p className="input-dialog-message">{message}</p> : null}
      <input
        ref={inputRef}
        type="text"
        className="input-dialog-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
      />
    </PmpDialog>
  );
};
