/* PLANEGY – Navigation, Mobile-Menu, dezente Einblendungen */
(function () {
  'use strict';

  /* --- Dropdown "Für wen" (Desktop) --- */
  var toggle = document.querySelector('.nav-sub-toggle');
  var submenu = toggle && document.getElementById(toggle.getAttribute('aria-controls'));

  if (toggle && submenu) {
    var wrapper = toggle.parentElement;

    var openSub = function () {
      toggle.setAttribute('aria-expanded', 'true');
      submenu.setAttribute('data-open', 'true');
    };
    var closeSub = function () {
      toggle.setAttribute('aria-expanded', 'false');
      submenu.removeAttribute('data-open');
    };

    toggle.addEventListener('click', function () {
      toggle.getAttribute('aria-expanded') === 'true' ? closeSub() : openSub();
    });
    wrapper.addEventListener('mouseenter', openSub);
    wrapper.addEventListener('mouseleave', closeSub);
    wrapper.addEventListener('focusout', function (e) {
      if (!wrapper.contains(e.relatedTarget)) closeSub();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        closeSub();
        toggle.focus();
      }
    });
    document.addEventListener('click', function (e) {
      if (!wrapper.contains(e.target)) closeSub();
    });
  }

  /* --- Mobile-Menü --- */
  var burger = document.querySelector('.nav-burger');
  var mobileNav = document.getElementById('mobileNav');

  if (burger && mobileNav) {
    var closeBtn = mobileNav.querySelector('.mobile-nav-close');

    var openNav = function () {
      mobileNav.setAttribute('data-open', 'true');
      burger.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      if (closeBtn) closeBtn.focus();
    };
    var closeNav = function () {
      mobileNav.removeAttribute('data-open');
      burger.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    };

    burger.addEventListener('click', openNav);
    if (closeBtn) closeBtn.addEventListener('click', function () { closeNav(); burger.focus(); });
    mobileNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', closeNav);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mobileNav.hasAttribute('data-open')) { closeNav(); burger.focus(); }
    });
  }

})();
