"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, Copy, Coins, Loader2, ExternalLink } from "lucide-react";
import { triggerRewardRedemption } from "@/hooks/useApi";

type CheckoutStep = "confirm" | "loading" | "success";

interface Reward {
  id: string;
  title: string;
  partnerStore?: string;
  partner?: string;
  pricePoints?: number;
  pointsRequired?: number;
  imageUrl?: string;
}

interface CheckoutDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  reward: Reward | null;
  userBalance: number;
  onSuccess?: (newBalance: number) => void;
}

export default function CheckoutDrawer({
  isOpen,
  onClose,
  reward,
  userBalance,
  onSuccess,
}: CheckoutDrawerProps) {
  const [step, setStep] = useState<CheckoutStep>("confirm");
  const [voucherCode, setVoucherCode] = useState<string>("");
  const [affiliateUrl, setAffiliateUrl] = useState<string>("");
  const [lastIsOpen, setLastIsOpen] = useState(isOpen);

  const price = reward?.pointsRequired || reward?.pricePoints || 0;
  const partner = reward?.partner || reward?.partnerStore || "Parceiro";
  const title = reward?.title || "Recompensa";

  // Reset state when opening
  if (isOpen !== lastIsOpen) {
    setLastIsOpen(isOpen);
    if (isOpen) {
      setStep("confirm");
      setVoucherCode("");
      setAffiliateUrl("");
    }
  }

  const handleRedeem = async () => {
    setStep("loading");
    try {
      const response = await triggerRewardRedemption(reward?.id || "mock-reward-id");

      if (!response.success) {
        throw new Error(response.error || "Falha no resgate");
      }

      const mockCode = `PONTUFY-${partner.substring(0, 4).toUpperCase()}-${Math.floor(
        1000 + Math.random() * 9000
      )}`;
      setVoucherCode(mockCode);
      if (response.affiliateUrl) {
        setAffiliateUrl(response.affiliateUrl);
      }

      setStep("success");
      
      if (onSuccess) {
        onSuccess(response.newBalance ?? (userBalance - price));
      }
    } catch (error) {
      console.error(error);
      alert("Erro ao realizar o resgate. Verifique seu saldo.");
      setStep("confirm");
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(voucherCode);
    alert("Código copiado com sucesso!");
  };

  // If Drawer is closed or no reward is selected, don't render content
  if (!isOpen || !reward) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex justify-end">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={step === "loading" ? undefined : onClose}
          className="absolute inset-0 bg-md-inverse-surface/40 backdrop-blur-sm"
        />

        {/* Drawer Panel */}
        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="relative w-full max-w-md h-full bg-md-surface shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-md-outline">
            <h2 className="text-xl font-bold text-md-on-surface">
              {step === "success" ? "Resgate Concluído" : "Confirmar Resgate"}
            </h2>
            <button
              onClick={onClose}
              disabled={step === "loading"}
              className="p-2 text-md-on-surface-variant hover:text-md-on-surface transition-colors disabled:opacity-50"
            >
              <X size={24} />
            </button>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-6 flex flex-col">
            {/* PRODUCT SUMMARY CARD */}
            <div className="bg-md-surface-container rounded-xl p-5 mb-8 border border-md-outline flex items-center gap-4">
              {reward.imageUrl ? (
                <div className="w-16 h-16 bg-md-surface rounded-lg p-2 border border-md-outline flex-shrink-0">
                  <img
                    src={reward.imageUrl}
                    alt={title}
                    className="w-full h-full object-contain mix-blend-multiply"
                  />
                </div>
              ) : (
                <div className="w-16 h-16 bg-md-surface rounded-lg p-2 border border-md-outline flex items-center justify-center flex-shrink-0">
                  <Coins className="text-md-tertiary" size={24} />
                </div>
              )}
              
              <div className="flex-1">
                <div className="text-[10px] font-bold text-md-on-surface-variant uppercase tracking-wider mb-1">
                  Na {partner}
                </div>
                <h3 className="font-bold text-md-on-surface leading-tight text-sm">
                  {title}
                </h3>
              </div>
            </div>

            {/* STEP: CONFIRM */}
            {step === "confirm" && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-6"
              >
                <div className="space-y-4">
                  <div className="flex justify-between items-center py-3 border-b border-md-outline">
                    <span className="text-md-on-surface-variant">Seu Saldo Atual</span>
                    <span className="font-bold text-md-tertiary">{userBalance} pts</span>
                  </div>
                  <div className="flex justify-between items-center py-3 border-b border-md-outline">
                    <span className="text-md-on-surface-variant">Valor do Resgate</span>
                    <span className="font-bold text-md-error">- {price} pts</span>
                  </div>
                  <div className="flex justify-between items-center py-3">
                    <span className="font-medium text-md-on-surface">Saldo Final</span>
                    <span className="font-black text-md-tertiary text-lg">
                      {userBalance - price} pts
                    </span>
                  </div>
                </div>

                <div className="mt-auto pt-8">
                  <button
                    onClick={handleRedeem}
                    className="w-full py-4 rounded-xl font-bold text-md-on-primary shadow-lg bg-md-primary hover:bg-md-primary-container hover:shadow-xl transition-all hover:scale-[1.02] flex items-center justify-center gap-2"
                  >
                    Confirmar Resgate
                  </button>
                </div>
              </motion.div>
            )}

            {/* STEP: LOADING (SHIMMER) */}
            {step === "loading" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex-1 flex flex-col items-center justify-center py-12 space-y-6"
              >
                <div className="relative w-20 h-20">
                  {/* Outer spinning ring */}
                  <div className="absolute inset-0 rounded-full border-4 border-md-tertiary/20 border-t-md-tertiary animate-spin"></div>
                  {/* Inner glowing core */}
                  <div className="absolute inset-2 bg-md-primary rounded-full animate-pulse opacity-20"></div>
                  <Loader2 className="absolute inset-0 m-auto text-md-primary animate-spin" size={32} />
                </div>
                <div className="text-center space-y-2">
                  <h3 className="font-bold text-md-on-surface text-lg">
                    Processando transação...
                  </h3>
                  <p className="text-md-on-surface-variant text-sm animate-pulse">
                    Comunicação segura com a API
                  </p>
                </div>
              </motion.div>
            )}

            {/* STEP: SUCCESS */}
            {step === "success" && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", damping: 20, stiffness: 300 }}
                className="flex flex-col flex-1"
              >
                <div className="flex flex-col items-center text-center mb-8 pt-4">
                  <div className="w-20 h-20 bg-md-tertiary/15 rounded-full flex items-center justify-center mb-6 text-md-tertiary">
                    <CheckCircle2 size={40} />
                  </div>
                  <h3 className="text-2xl font-black text-md-on-surface mb-2">
                    Tudo Certo!
                  </h3>
                  <p className="text-md-on-surface-variant">
                    O resgate de <strong className="text-md-tertiary">{price} pts</strong> foi concluído.
                  </p>
                </div>

                <div className="bg-md-surface-container border border-md-outline border-dashed rounded-xl p-6 text-center mb-8 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-md-primary to-md-primary-container"></div>
                  <p className="text-xs text-md-on-surface-variant font-bold uppercase tracking-wider mb-3">
                    Seu Código de Resgate
                  </p>
                  <div className="font-mono text-2xl font-black text-md-primary tracking-widest mb-4">
                    {voucherCode}
                  </div>
                  <button
                    onClick={copyToClipboard}
                    className="mx-auto flex items-center justify-center gap-2 px-4 py-2 bg-md-surface border border-md-outline rounded-lg text-sm font-medium text-md-on-surface hover:bg-md-surface-container transition-colors shadow-sm"
                  >
                    <Copy size={16} /> Copiar Código
                  </button>
                </div>

                <div className="mt-auto flex flex-col gap-3">
                  {affiliateUrl ? (
                    <a
                      href={affiliateUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-3.5 rounded-xl font-bold text-md-on-primary shadow-md bg-md-primary hover:bg-md-primary-container transition-colors flex items-center justify-center gap-2"
                    >
                      Acessar {partner} <ExternalLink size={18} />
                    </a>
                  ) : (
                    <button
                      onClick={onClose}
                      className="w-full py-3.5 rounded-xl font-bold text-md-on-primary shadow-md bg-md-primary hover:bg-md-primary-container transition-colors flex items-center justify-center gap-2"
                    >
                      Fechar
                    </button>
                  )}
                  <button
                    onClick={onClose}
                    className="w-full py-3.5 rounded-xl font-bold text-md-primary hover:bg-md-surface-container transition-colors"
                  >
                    Voltar para o Catálogo
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
