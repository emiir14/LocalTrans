/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { BenchmarkView } from './components/BenchmarkView';
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
  const { currentView, setView, init } = useAppStore();

  useEffect(() => {
    init();

    // Check if initial URL is /benchmark or hash
    const path = window.location.pathname;
    if (path.includes('/benchmark') || window.location.hash === '#benchmark') {
      setView('benchmark');
    }
  }, [init, setView]);

  return (
    <div className="min-h-full flex flex-col bg-[#FAFAF8] text-slate-800 dark:bg-slate-950 dark:text-slate-100 transition-colors">
      {/* Top Bar Header (suppressed during active recording to ensure zero distraction) */}
      {currentView !== 'recording' && <TopBar />}

      {/* Main Content Area */}
      <main className="flex-1">
        {currentView === 'home' && <HomeView />}
        {currentView === 'recording' && <RecordingView />}
        {currentView === 'detail' && <DetailView />}
        {currentView === 'settings' && <SettingsView />}
        {currentView === 'privacy' && <PrivacyView />}
        {currentView === 'benchmark' && <BenchmarkView />}
      </main>

      {/* First-use modal & notification toast */}
      <OnboardingModal />
      <Toast />
    </div>
  );
}
