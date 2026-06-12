import React from 'react';
import { Navbar } from '../components/Navbar';
import { Hero } from '../components/Hero';
import { Features } from '../components/Features';
import { Footer } from '../components/Footer';

export const Landing: React.FC = () => {
  return (
    <div className="page-wrapper">
      <Navbar />
      <main>
        <Hero />
        <Features />
      </main>
      <Footer />
    </div>
  );
};
