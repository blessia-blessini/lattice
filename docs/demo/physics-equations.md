# Physics Notes — Equations Reference
### Study Document for Physics Students

> **Open in Lattice** (Preview or Dual mode) to render all equations via KaTeX.
> All math uses standard LaTeX notation: `$...$` for inline, `$$...$$` for display blocks.
> ==Highlighted terms== mark definitions and key results worth memorising.

---

## Table of Contents

<!-- TOC -->
- [Fundamental Constants](#fundamental-constants)
- [Classical Mechanics](#classical-mechanics)
- [Electromagnetism — Maxwell's Equations](#electromagnetism--maxwells-equations)
- [Thermodynamics & Statistical Mechanics](#thermodynamics--statistical-mechanics)
- [Quantum Mechanics](#quantum-mechanics)
- [Special Relativity](#special-relativity)
- [Waves & Optics](#waves--optics)
- [Fluid Mechanics](#fluid-mechanics)
- [Next Steps — Study Checklist](#next-steps--study-checklist)
<!-- /TOC -->

---

## Fundamental Constants

| Constant | Symbol | Value | Units |
|:---------|:------:|------:|:------|
| Speed of light | $c$ | $2.998 \times 10^8$ | m s⁻¹ |
| Planck constant | $h$ | $6.626 \times 10^{-34}$ | J s |
| Reduced Planck | $\hbar = h/2\pi$ | $1.055 \times 10^{-34}$ | J s |
| Elementary charge | $e$ | $1.602 \times 10^{-19}$ | C |
| Electron mass | $m_e$ | $9.109 \times 10^{-31}$ | kg |
| Proton mass | $m_p$ | $1.673 \times 10^{-27}$ | kg |
| Boltzmann constant | $k_B$ | $1.381 \times 10^{-23}$ | J K⁻¹ |
| Gravitational constant | $G$ | $6.674 \times 10^{-11}$ | N m² kg⁻² |
| Avogadro number | $N_A$ | $6.022 \times 10^{23}$ | mol⁻¹ |
| Vacuum permittivity | $\varepsilon_0$ | $8.854 \times 10^{-12}$ | F m⁻¹ |
| Vacuum permeability | $\mu_0$ | $4\pi \times 10^{-7}$ | T m A⁻¹ |

---

## Classical Mechanics

### Newton's Laws

==Newton's Second Law== — the net force equals rate of change of momentum:

$$
\vec{F} = \frac{d\vec{p}}{dt} = m\vec{a}
\quad\text{(constant mass)}
$$

The ==work-energy theorem==:

$$
W = \int_{\vec{r}_1}^{\vec{r}_2} \vec{F} \cdot d\vec{r}
= \Delta K = \frac{1}{2}mv_f^2 - \frac{1}{2}mv_i^2
$$

### Rotational Dynamics

Torque and angular momentum satisfy the same structure as $F = ma$:

$$
\vec{\tau} = \vec{r} \times \vec{F} = \frac{d\vec{L}}{dt}
\qquad
\vec{L} = I\,\vec{\omega} = \vec{r} \times \vec{p}
$$

The ==moment of inertia== for a continuous body:

$$
I = \int r^2\, dm
$$

Parallel-axis theorem — shift the rotation axis by distance $d$ from the centre of mass:

$$
I = I_\text{cm} + Md^2
$$

### Gravitation

Newton's universal law of gravitation:

$$
\vec{F} = -\frac{G M m}{r^2}\hat{r}
$$

Gravitational potential energy and escape velocity:

$$
U(r) = -\frac{GMm}{r}
\qquad
v_\text{esc} = \sqrt{\frac{2GM}{r}}
$$

==Kepler's Third Law== (circular orbit approximation):

$$
T^2 = \frac{4\pi^2}{GM} a^3
$$

### Lagrangian & Hamiltonian Mechanics

The ==Lagrangian== $\mathcal{L} = T - V$ and ==Euler-Lagrange equation==:

$$
\frac{d}{dt}\!\left(\frac{\partial \mathcal{L}}{\partial \dot{q}_i}\right) - \frac{\partial \mathcal{L}}{\partial q_i} = 0
$$

The ==Hamiltonian== $\mathcal{H} = T + V$ and Hamilton's equations:

$$
\dot{q}_i = \frac{\partial \mathcal{H}}{\partial p_i}
\qquad
\dot{p}_i = -\frac{\partial \mathcal{H}}{\partial q_i}
$$

---

## Electromagnetism — Maxwell's Equations

In SI units, the ==four Maxwell equations== in differential form:

$$
\nabla \cdot \vec{E} = \frac{\rho}{\varepsilon_0}
\tag{Gauss — Electric}
$$

$$
\nabla \cdot \vec{B} = 0
\tag{Gauss — Magnetic}
$$

$$
\nabla \times \vec{E} = -\frac{\partial \vec{B}}{\partial t}
\tag{Faraday}
$$

$$
\nabla \times \vec{B} = \mu_0\vec{J} + \mu_0\varepsilon_0\frac{\partial \vec{E}}{\partial t}
\tag{Ampère–Maxwell}
$$

### Electromagnetic Wave Equation

From the curl equations, in free space ($\rho = 0$, $\vec{J} = 0$):

$$
\nabla^2 \vec{E} = \mu_0\varepsilon_0 \frac{\partial^2 \vec{E}}{\partial t^2}
\implies
c = \frac{1}{\sqrt{\mu_0\varepsilon_0}} = 2.998 \times 10^8 \text{ m/s}
$$

### Lorentz Force

A charge $q$ moving with velocity $\vec{v}$ in fields $\vec{E}$, $\vec{B}$:

$$
\vec{F} = q\!\left(\vec{E} + \vec{v} \times \vec{B}\right)
$$

### Energy Density & Poynting Vector

Energy stored in the electromagnetic field and its flow:

$$
u = \frac{1}{2}\varepsilon_0 E^2 + \frac{1}{2\mu_0}B^2
\qquad
\vec{S} = \frac{1}{\mu_0}\vec{E} \times \vec{B}
$$

---

## Thermodynamics & Statistical Mechanics

### Laws of Thermodynamics

==Zeroth Law== — Thermal equilibrium is transitive (defines temperature).

==First Law== — Energy conservation:

$$
dU = \delta Q - \delta W = \delta Q - p\,dV
$$

==Second Law== — Entropy of an isolated system never decreases:

$$
dS \geq \frac{\delta Q}{T}
\qquad\text{(equality for reversible processes)}
$$

==Third Law== — Entropy approaches a constant as $T \to 0$:

$$
\lim_{T \to 0} S = S_0 \geq 0
$$

### Thermodynamic Potentials

| Potential | Definition | Natural variables |
|:----------|:-----------|:-----------------|
| Internal energy | $U$ | $S, V, N$ |
| Enthalpy | $H = U + pV$ | $S, p, N$ |
| Helmholtz free energy | $F = U - TS$ | $T, V, N$ |
| Gibbs free energy | $G = U - TS + pV$ | $T, p, N$ |

Spontaneous processes at constant $T, p$: $\Delta G \leq 0$.

### Ideal Gas

$$
pV = Nk_BT = nRT
\qquad
U = \frac{f}{2}Nk_BT
$$

where $f$ is the number of degrees of freedom ($f = 3$ monatomic, $f = 5$ diatomic).

### Boltzmann Distribution

The ==canonical ensemble== probability of a microstate with energy $E_i$:

$$
P_i = \frac{e^{-E_i / k_B T}}{Z}
\qquad
Z = \sum_i e^{-E_i / k_B T}
$$

The Helmholtz free energy from the partition function:

$$
F = -k_B T \ln Z
$$

### Entropy — Boltzmann Formula

$$
\boxed{S = k_B \ln \Omega}
$$

where $\Omega$ is the number of accessible microstates — ==the most important equation in statistical mechanics==.

---

## Quantum Mechanics

### Schrödinger Equations

==Time-dependent Schrödinger equation==:

$$
i\hbar\frac{\partial}{\partial t}\Psi(\vec{r},t)
= \hat{H}\,\Psi(\vec{r},t)
= \left[-\frac{\hbar^2}{2m}\nabla^2 + V(\vec{r},t)\right]\Psi(\vec{r},t)
$$

==Time-independent== (stationary states):

$$
\hat{H}\,\psi(\vec{r}) = E\,\psi(\vec{r})
$$

### Uncertainty Principle

==Heisenberg uncertainty relations==:

$$
\Delta x \cdot \Delta p \geq \frac{\hbar}{2}
\qquad
\Delta E \cdot \Delta t \geq \frac{\hbar}{2}
$$

### Particle in a 1-D Box

Energy eigenvalues and normalised eigenfunctions for a box of length $L$:

$$
E_n = \frac{n^2 \pi^2 \hbar^2}{2mL^2}
\qquad
\psi_n(x) = \sqrt{\frac{2}{L}}\sin\!\left(\frac{n\pi x}{L}\right)
\quad n = 1, 2, 3, \ldots
$$

### Hydrogen Atom

Energy levels (Bohr model / exact non-relativistic):

$$
E_n = -\frac{m_e e^4}{2(4\pi\varepsilon_0)^2\hbar^2} \cdot \frac{1}{n^2}
= -\frac{13.6\text{ eV}}{n^2}
\quad n = 1, 2, 3, \ldots
$$

Bohr radius $a_0$ and ground-state wavefunction:

$$
a_0 = \frac{4\pi\varepsilon_0\hbar^2}{m_e e^2} \approx 0.529\text{ Å}
\qquad
\psi_{100} = \frac{1}{\sqrt{\pi a_0^3}}\,e^{-r/a_0}
$$

### Dirac Notation & Commutators

Inner product and expectation value:

$$
\langle\psi|\phi\rangle = \int_{-\infty}^{\infty}\psi^*(x)\phi(x)\,dx
\qquad
\langle\hat{A}\rangle = \langle\psi|\hat{A}|\psi\rangle
$$

Canonical commutation relation (==fundamental to quantisation==):

$$
[\hat{x},\hat{p}] = i\hbar
$$

Ladder operators for the harmonic oscillator:

$$
\hat{a} = \sqrt{\frac{m\omega}{2\hbar}}\!\left(\hat{x}+\frac{i\hat{p}}{m\omega}\right)
\qquad
E_n = \hbar\omega\!\left(n + \tfrac{1}{2}\right)
$$

---

## Special Relativity

### Lorentz Transformations

For a frame $S'$ moving with velocity $v$ along $x$:

$$
\gamma = \frac{1}{\sqrt{1 - \beta^2}}
\qquad
\beta = \frac{v}{c}
$$

$$
t' = \gamma\!\left(t - \frac{vx}{c^2}\right)
\qquad
x' = \gamma(x - vt)
$$

### Energy–Momentum Relation

==The relativistic energy equation== (reduces to $E=mc^2$ at rest):

$$
\boxed{E^2 = (pc)^2 + (m_0 c^2)^2}
$$

Total energy, kinetic energy, and rest energy:

$$
E = \gamma m_0 c^2
\qquad
K = (\gamma - 1)m_0 c^2
\qquad
E_0 = m_0 c^2
$$

### Four-Vectors

The spacetime interval is a Lorentz invariant:

$$
s^2 = c^2 t^2 - x^2 - y^2 - z^2 = \text{invariant}
$$

Four-momentum: $p^\mu = (E/c,\; p_x,\; p_y,\; p_z)$, with $p^\mu p_\mu = (m_0 c)^2$.

---

## Waves & Optics

### Wave Equation

The ==general wave equation== in one dimension:

$$
\frac{\partial^2 u}{\partial t^2} = v^2\frac{\partial^2 u}{\partial x^2}
$$

Solution: $u(x,t) = A\cos(kx - \omega t + \phi)$, where $\omega = vk$.

### Interference & Diffraction

==Double-slit== (Young) interference — bright fringe condition:

$$
d\sin\theta = m\lambda \quad m = 0, \pm 1, \pm 2, \ldots
$$

Single-slit diffraction — ==first dark fringe==:

$$
a\sin\theta = \lambda
$$

==Rayleigh criterion== for angular resolution:

$$
\theta_\text{min} = 1.22\frac{\lambda}{D}
$$

### Snell's Law & Total Internal Reflection

$$
n_1 \sin\theta_1 = n_2 \sin\theta_2
\qquad
\theta_c = \arcsin\!\left(\frac{n_2}{n_1}\right)
\quad(n_1 > n_2)
$$

---

## Fluid Mechanics

### Continuity & Bernoulli

For an incompressible, inviscid fluid in steady flow:

$$
\nabla \cdot \vec{v} = 0
\qquad\text{(continuity)}
$$

$$
p + \frac{1}{2}\rho v^2 + \rho g h = \text{const}
\qquad\text{(Bernoulli)}
$$

### Navier–Stokes Equation

The full ==incompressible Navier–Stokes equation== (one of the Millennium Prize Problems):

$$
\rho\!\left(\frac{\partial \vec{v}}{\partial t} + (\vec{v}\cdot\nabla)\vec{v}\right)
= -\nabla p + \mu\,\nabla^2\vec{v} + \rho\vec{g}
$$

Reynolds number (ratio of inertial to viscous forces):

$$
Re = \frac{\rho v L}{\mu}
$$

---

## Next Steps — Study Checklist

> Track your revision progress here. Check off topics as you feel confident.

### Classical Mechanics
- [ ] Derive Kepler's laws from Newton's law of gravitation
- [ ] Solve the Lagrangian for a double pendulum
- [ ] Prove the parallel-axis theorem from first principles
- [ ] Work through Hamilton's equations for a charged particle in an EM field

### Electromagnetism
- [ ] Derive the wave equation from Maxwell's equations (vacuum case)
- [ ] Solve Laplace's equation in spherical coordinates (Legendre polynomials)
- [ ] Calculate the magnetic field of a solenoid using Ampère's law
- [ ] Work through radiation from an accelerating charge (Larmor formula)

### Quantum Mechanics
- [ ] Solve the harmonic oscillator using ladder operators
- [ ] Derive the hydrogen energy levels from the radial Schrödinger equation
- [ ] Study the WKB approximation for tunnelling problems
- [ ] Review perturbation theory — first and second order corrections

### Thermodynamics
- [ ] Derive the Carnot efficiency from the Second Law
- [ ] Compute the partition function for a two-level system
- [ ] Understand the connection between $F = -k_BT\ln Z$ and thermodynamic observables
- [ ] Work through the van der Waals equation of state

### Special Relativity
- [ ] Derive the Lorentz transformations from the two postulates
- [ ] Solve the twin paradox carefully
- [ ] Understand how $E^2 = (pc)^2 + (m_0c^2)^2$ reduces in the massless and non-relativistic limits
- [ ] Study relativistic collisions and 4-momentum conservation

---

*Part of the Lattice demo suite.  
See also: [Feature Showcase](demo.md) · [System Architecture](system-architecture.md)*
