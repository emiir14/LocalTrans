/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { ConfirmModal } from './components/ConfirmModal';
import { DetailView } from './components/DetailView';
import { HomeView } from './components/HomeView';
import { OnboardingModal } from './components/OnboardingModal';
import { PrivacyView } from './components/PrivacyView';
import { RecordingView } from './components/RecordingView';
import { SettingsView } from './components/SettingsView';
import { Toast } from './components/Toast';
import { TopBar } from './components/TopBar';
import { useAppStore } from './store/useAppStore';

export default function App() {
  const { currentView, setView, init, isRecording, transcribingSessionId } = useAppStore();

  useEffect(() => {
    init();

    // Check if initial URL is /benchmark or hash - redirect to settings
    const path = window.location.pathname;
    if (path.includes('/benchmark') || window.location.hash === '#benchmark') {
      setView('settings');
    }
  }, [init, setView]);

  // Prevent accidental tab closure or refresh during recording or transcription
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isRecording || transcribingSessionId) {
        e.preventDefault();
        // Standard trigger for modern browsers to display leave confirmation dialog
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isRecording, transcribingSessionId]);

  return (
    <div className="min-h-full flex flex-col bg-[#EDEFEA] text-slate-800 dark:bg-slate-950 dark:text-slate-100 transition-colors">
      {/* Top Bar Header (suppressed during active recording to ensure zero distraction) */}
      {currentView !== 'recording' && <TopBar />}

      {/* Main Content Area */}
      <main className="flex-1">
        {currentView === 'home' && <HomeView />}
        {currentView === 'recording' && <RecordingView />}
        {currentView === 'detail' && <DetailView />}
        {currentView === 'settings' && <SettingsView />}
        {currentView === 'privacy' && <PrivacyView />}
      </main>

      {/* First-use modal, confirm dialog & notification toast */}
      <OnboardingModal />
      <ConfirmModal />
      <Toast />
    </div>
  );
}
