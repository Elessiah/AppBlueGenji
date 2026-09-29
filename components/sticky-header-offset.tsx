"use client";

import { useEffect } from "react";
import {
  STICKY_HEADER_ATTR,
  STICKY_HEADER_HEIGHT_VAR,
  stickyHeaderHeightValue,
} from "@/lib/shared/sticky-header";

/**
 * Mesure l'en-tête collant de la page (`[data-sticky-header]`) et pose sa
 * hauteur sur `<html>` (`--sticky-header-h`), que lit `scroll-padding-top` :
 * une ancre ou un focus ramené en haut de la vue s'arrête **sous** l'en-tête,
 * quelle que soit sa hauteur du moment (`lib/shared/sticky-header.ts`).
 *
 * L'en-tête est remplacé sans que le chemin change — vitrine ↔ espace
 * connecté, mais aussi la page d'erreur qui le retire puis « Réessayer » qui le
 * remonte sur la même URL : on le recherche donc dès qu'il a quitté le
 * document (`MutationObserver`, vérification regroupée par image). La hauteur
 * suit ses redimensionnements (`ResizeObserver`) et la fenêtre (un écran bas
 * le fait repasser en `position: relative`, marge nulle). Ne rend rien.
 */
export function StickyHeaderOffset() {
  useEffect(() => {
    const root = document.documentElement;
    let header: HTMLElement | null = null;
    let frame = 0;
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => apply());

    function apply() {
      const value = header
        ? stickyHeaderHeightValue(header.getBoundingClientRect().height, getComputedStyle(header).position)
        : stickyHeaderHeightValue(null);
      root.style.setProperty(STICKY_HEADER_HEIGHT_VAR, value);
    }

    function track() {
      frame = 0;
      if (header?.isConnected) return;
      resizeObserver?.disconnect();
      header = document.querySelector<HTMLElement>(`[${STICKY_HEADER_ATTR}]`);
      if (header) resizeObserver?.observe(header);
      apply();
    }

    const scheduleTrack = () => {
      if (!frame) frame = window.requestAnimationFrame(track);
    };
    const mutationObserver = new MutationObserver(scheduleTrack);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", apply);
    track();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, []);

  return null;
}
