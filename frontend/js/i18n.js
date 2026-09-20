const translations = {
  en: {
    brand_title: 'SetuOne',
    sign_out: 'Sign out',
    overview: 'Cross-department overview',
    total_applications: 'Total Applications',
    sla_compliance: 'SLA Compliance',
    open_grievances: 'Open Grievances',
    who_accessed_my_data: 'Who Accessed My Data',
    consent_management: 'Consent Management',
    recommended_schemes: 'Recommended Schemes for You',
    apply_prefilled: 'Apply with pre-filled details',
    status_submitted: 'Submitted',
    status_in_progress: 'In Progress',
    status_completed: 'Completed',
    status_rejected: 'Rejected',
    status_at_risk: 'At Risk',
    status_escalated: 'Escalated',
    language: 'Language',
    ai_assistant_title: 'SetuOne AI Assistant',
    ai_disclaimer: '[AI Generated Answer]'
  },
  hi: {
    brand_title: 'सेतु-वन',
    sign_out: 'साइन आउट',
    overview: 'अंतर-विभागीय अवलोकन',
    total_applications: 'कुल आवेदन',
    sla_compliance: 'एसएलए अनुपालन',
    open_grievances: 'खुली शिकायतें',
    who_accessed_my_data: 'किसने मेरा डेटा एक्सेस किया',
    consent_management: 'सहमति प्रबंधन',
    recommended_schemes: 'आपके लिए अनुशंसित योजनाएं',
    apply_prefilled: 'पूर्वावलोकन विवरण के साथ आवेदन करें',
    status_submitted: 'प्रस्तुत',
    status_in_progress: 'प्रगति में',
    status_completed: 'पूर्ण',
    status_rejected: 'अस्वीकृत',
    status_at_risk: 'जोखिम में',
    status_escalated: 'एस्कलेटेड',
    language: 'भाषा',
    ai_assistant_title: 'सेतु-वन एआई सहायक',
    ai_disclaimer: '[एआई जनरेटेड उत्तर]'
  },
  mr: {
    brand_title: 'सेतू-वन',
    sign_out: 'साइन आउट',
    overview: 'आंतर-विभागीय आढावा',
    total_applications: 'एकूण अर्ज',
    sla_compliance: 'एसएलए पालन',
    open_grievances: 'उघड्या तक्रारी',
    who_accessed_my_data: 'माझा डेटा कोणी पाहिला',
    consent_management: 'संमती व्यवस्थापन',
    recommended_schemes: 'आपल्यासाठी शिफारस केलेल्या योजना',
    apply_prefilled: 'पूर्व-भरलेल्या माहितीसह अर्ज करा',
    status_submitted: 'सादर केले',
    status_in_progress: 'प्रगतीपथावर',
    status_completed: 'पूर्ण झाले',
    status_rejected: 'नाकारले',
    status_at_risk: 'धोक्यात',
    status_escalated: 'वरिष्ठांकडे पाठवले',
    language: 'भाषा',
    ai_assistant_title: 'सेतू-वन एआय सहाय्यक',
    ai_disclaimer: '[एआय जनरेट केलेले उत्तर]'
  }
};

let currentLang = localStorage.getItem('setuone_lang') || 'en';

function setLanguage(lang) {
  if (translations[lang]) {
    currentLang = lang;
    localStorage.setItem('setuone_lang', lang);
    applyTranslations();
  }
}

function t(key) {
  return translations[currentLang]?.[key] || translations.en[key] || key;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applyTranslations();
});
