import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

const languages = [
  { code: 'en', name: 'English' },
  { code: 'th', name: 'ไทย' },
  { code: 'ru', name: 'Русский' },
  { code: 'zh', name: '中文' },
];

const LanguageSwitcher = () => {
  const { i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, right: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentLanguage = i18n.resolvedLanguage || i18n.language || 'en';
  const currentLangData = languages.find(lang => lang.code === currentLanguage) || languages[0];

  const handleLanguageChange = (value: string) => {
    i18n.changeLanguage(value);
    localStorage.setItem('opsian_lang', value);
    setIsOpen(false);
  };

  // Calculate dropdown position
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + window.scrollY + 8,
        right: window.innerWidth - rect.right + window.scrollX,
      });
    }
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        buttonRef.current && 
        !buttonRef.current.contains(event.target as Node) &&
        dropdownRef.current && 
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const dropdownContent = isOpen && (
    <div
      ref={dropdownRef}
      className="fixed w-[140px] bg-white/95 backdrop-blur-md border border-white/30 rounded-md shadow-xl z-[99999] overflow-hidden"
      style={{
        top: `${position.top}px`,
        right: `${position.right}px`,
      }}
    >
      {languages.map((lang) => (
        <button
          key={lang.code}
          onClick={() => handleLanguageChange(lang.code)}
          className="w-full px-3 py-2 text-left text-sm hover:bg-white/20 focus:bg-white/20 focus:outline-none flex items-center justify-between cursor-pointer transition-colors text-gray-900"
        >
          <span>{lang.name}</span>
          {currentLanguage === lang.code && (
            <Check className="h-4 w-4" />
          )}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <div className="relative">
        <Button
          ref={buttonRef}
          variant="ghost"
          size="sm"
          onClick={() => setIsOpen(!isOpen)}
          className="text-white hover:text-white hover:bg-white/10 w-[140px] justify-between"
        >
          <div className="flex items-center">
            <Globe className="h-4 w-4 mr-2" />
            <span>{currentLangData.name}</span>
          </div>
          <ChevronDown className={`h-4 w-4 ml-2 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </Button>
      </div>
      {typeof window !== 'undefined' && createPortal(dropdownContent, document.body)}
    </>
  );
};

export default LanguageSwitcher;
