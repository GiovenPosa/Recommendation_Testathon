import React from "react";
import { BrowserRouter as Router, Routes, Route, BrowserRouter } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import PreviewProfile from './pages/PreviewProfile';
import RecommendationResults from "./pages/RecommendationResults";


function App() {
  return (
   
    <Routes>
      <Route path='/' element={ <LandingPage/> } />
      <Route path="/preview-profile/:userId" element={ <PreviewProfile/> } />
      <Route path='/recommendation-results/:userId' element={ <RecommendationResults/> } />

    </Routes>
  );
}

export default App;